import { fetchNpbPage, FETCH_INTERVAL_MS, NPB_BASE_URL, sleep } from '@/lib/npb/fetch'
import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * 「今季達成が予想される記録」のページを取って、そのまま置いておく。
 *
 *   打撃   /history/2026/milestones_b.html
 *   投手   /history/2026/milestones_p.html
 *   チーム /history/2026/milestones_team.html
 *
 * これらは「あと何本で通算◯◯」という形で、達成が近い選手が並ぶページ。
 * 毎日取って前日と比べれば、マリーンズの選手が記録に届いた日が分かる。
 *
 * 今の段階では読み取らない。中身を見ないと読み取り方を決められないので、
 * 試合のときと同じく「貯めるだけ」から始める。ここで金額は動かない。
 */

type Admin = ReturnType<typeof createAdminClient>

export const MILESTONE_KINDS = ['batting', 'pitching', 'team'] as const

export type MilestoneKind = (typeof MILESTONE_KINDS)[number]

/** ページの名前。URL の末尾に使う */
const PAGE_SLUG: Record<MilestoneKind, string> = {
  batting: 'milestones_b',
  pitching: 'milestones_p',
  team: 'milestones_team',
}

export function milestoneUrl(kind: MilestoneKind, season: number): string {
  return `${NPB_BASE_URL}/history/${season}/${PAGE_SLUG[kind]}.html`
}

export type MilestoneSnapshotItem = {
  kind: MilestoneKind
  status: 'saved' | 'failed'
  /** 取れた文字数。極端に少なければ中身が変わった疑い */
  length?: number
  reason?: string
}

export type MilestoneSnapshotResult = {
  season: number
  saved: number
  items: MilestoneSnapshotItem[]
}

export async function snapshotMilestonePages(
  supabase: Admin,
  season: number,
  fetchPage: (url: string) => Promise<string> = fetchNpbPage
): Promise<MilestoneSnapshotResult> {
  const items: MilestoneSnapshotItem[] = []

  for (const [index, kind] of MILESTONE_KINDS.entries()) {
    // 相手に負担をかけないよう、続けて取るときは必ず間隔を空ける
    if (index > 0) await sleep(FETCH_INTERVAL_MS)

    const url = milestoneUrl(kind, season)
    try {
      const html = await fetchPage(url)

      // 取れたことにして空を保存すると、解析側が「記録なし」と誤解する
      if (html.trim().length === 0) {
        items.push({ kind, status: 'failed', reason: '中身が空でした' })
        continue
      }

      const { error } = await supabase
        .from('npb_milestone_pages')
        .upsert({ kind, url, html, season, fetched_at: new Date().toISOString() }, { onConflict: 'kind' })

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
