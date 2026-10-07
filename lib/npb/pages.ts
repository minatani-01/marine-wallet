import { fetchNpbPage, FETCH_INTERVAL_MS, MARINES_TEAM_CODE, NPB_BASE_URL, sleep } from '@/lib/npb/fetch'
import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * 記録達成の判定に使うページを取って、そのまま置いておく。
 *
 *   達成が予想される記録（打撃）   /history/<年>/milestones_b.html
 *   達成が予想される記録（投手）   /history/<年>/milestones_p.html
 *   達成が予想される記録（チーム） /history/<年>/milestones_team.html
 *   選手名鑑（マリーンズ）         /bis/teams/rst_m.html
 *
 * 記録のページは、各記録の見出しの下に表が2つ並ぶ。
 *   達成済み … 氏名 / 所属 / 達成日 / 相手 / …
 *   これから … 氏名 / 所属 / 昨年まで / 達成まで / …
 * 達成済みの表に達成日が入るので、前日と比べなくても達成が分かる。
 *
 * 選手名鑑は背番号のために取る。記録のページには背番号が無く、
 * 「#51山口」の形で書けないため。
 *
 * この段階では読み取らない。中身を見ないと読み取り方を決められないので、
 * 試合のときと同じく「貯めるだけ」から始める。ここで金額は動かない。
 */

type Admin = ReturnType<typeof createAdminClient>

export const SOURCE_PAGE_KINDS = [
  'milestone_batting',
  'milestone_pitching',
  'milestone_team',
  'roster',
] as const

/**
 * 毎朝の取り込みが取ってきたページのうち、ここでは取りに行かないもの。
 *
 * 個人成績は読み取りのために別で取っている。同じページを2回取りに行かず、
 * 取ったものをそのまま渡してもらって保存する（lib/npb/sync.ts）。
 *
 * 保存しておく理由は、読めなくなったときに中身を見るため。2026年の最終戦の
 * 翌日に「基準日を読めませんでした」が出たが、ページを残していなかったので
 * 何がどう変わったのか確かめられなかった。
 */
export const PASSED_PAGE_KINDS = ['stats_batting', 'stats_pitching'] as const

export type PassedPageKind = (typeof PASSED_PAGE_KINDS)[number]

export type PassedPage = { kind: PassedPageKind; url: string; html: string }

/**
 * 取り込みが取ってきたページをそのまま残す。
 *
 * 読み取りには関わらないので、失敗しても呼び出し側は止めない。
 * 保存できなかったことだけ返す。
 */
export async function saveFetchedPages(
  supabase: Admin,
  season: number,
  pages: PassedPage[]
): Promise<SourcePageItem[]> {
  const items: SourcePageItem[] = []

  for (const page of pages) {
    if (page.html.trim().length === 0) {
      items.push({ kind: page.kind, status: 'failed', reason: '中身が空でした' })
      continue
    }

    const { error } = await supabase.from('npb_source_pages').upsert(
      {
        kind: page.kind,
        url: page.url,
        html: page.html,
        season,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'kind' }
    )

    items.push(
      error
        ? { kind: page.kind, status: 'failed', reason: `保存できませんでした: ${error.message}` }
        : { kind: page.kind, status: 'saved', length: page.html.length }
    )
  }

  return items
}

export type SourcePageKind = (typeof SOURCE_PAGE_KINDS)[number]

/** npb_source_pages に入りうる種類。取りに行くものと、渡されるもの */
export type StoredPageKind = SourcePageKind | PassedPageKind

export function sourcePageUrl(kind: SourcePageKind, season: number): string {
  switch (kind) {
    case 'milestone_batting':
      return `${NPB_BASE_URL}/history/${season}/milestones_b.html`
    case 'milestone_pitching':
      return `${NPB_BASE_URL}/history/${season}/milestones_p.html`
    case 'milestone_team':
      return `${NPB_BASE_URL}/history/${season}/milestones_team.html`
    case 'roster':
      // 名鑑は年で分かれていない。常に今の登録選手が出る
      return `${NPB_BASE_URL}/bis/teams/rst_${MARINES_TEAM_CODE}.html`
  }
}

export type SourcePageItem = {
  kind: StoredPageKind
  status: 'saved' | 'failed'
  /** 取れた文字数。極端に少なければ中身が変わった疑い */
  length?: number
  reason?: string
}

export type SourcePageResult = {
  season: number
  saved: number
  items: SourcePageItem[]
}

export async function snapshotSourcePages(
  supabase: Admin,
  season: number,
  fetchPage: (url: string) => Promise<string> = fetchNpbPage
): Promise<SourcePageResult> {
  const items: SourcePageItem[] = []

  for (const [index, kind] of SOURCE_PAGE_KINDS.entries()) {
    // 相手に負担をかけないよう、続けて取るときは必ず間隔を空ける
    if (index > 0) await sleep(FETCH_INTERVAL_MS)

    const url = sourcePageUrl(kind, season)
    try {
      const html = await fetchPage(url)

      // 取れたことにして空を保存すると、解析側が「記録なし」と誤解する
      if (html.trim().length === 0) {
        items.push({ kind, status: 'failed', reason: '中身が空でした' })
        continue
      }

      const { error } = await supabase
        .from('npb_source_pages')
        .upsert(
          { kind, url, html, season, fetched_at: new Date().toISOString() },
          { onConflict: 'kind' }
        )

      if (error) {
        items.push({ kind, status: 'failed', reason: `保存できませんでした: ${error.message}` })
        continue
      }

      items.push({ kind, status: 'saved', length: html.length })
    } catch (cause) {
      items.push({
        kind,
        status: 'failed',
        reason: `取得できませんでした: ${cause instanceof Error ? cause.message : String(cause)}`,
      })
    }
  }

  return {
    season,
    saved: items.filter((i) => i.status === 'saved').length,
    items,
  }
}
