import {
  milestoneTitle,
  parseCareerMilestones,
  parseRoster,
  parseSeasonMilestones,
  parseUpcomingMilestones,
  uniformNumberOf,
  type Milestone,
  type RosterEntry,
} from '@/lib/npb/milestones'
import type { StatSnapshot } from '@/lib/npb/stats'
import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * 読み取った記録を台帳（npb_milestones）へ入れる。
 *
 * ここでは積立を作らない。台帳に行が入ると DB のトリガー
 * （npb_milestones_sync_entries → sync_saving_entry_for_milestone）が
 * 対象者ぶんをまとめて作る。試合のときと同じ形にして、金額の計算を
 * 2か所に置かないようにする。
 *
 * ページの取得もしない。毎朝の取り込みが npb_source_pages と
 * npb_player_stat_snapshots に貯めたものを読むだけなので、
 * 何度呼んでも npb.jp には出ていかない。
 *
 * 二重登録は台帳の一意キー (season, source, record_label, holder) で防ぐ。
 * 毎朝走らせても、同じ記録が積み上がることはない。
 */

type Admin = ReturnType<typeof createAdminClient>

export type MilestoneRegisterResult = {
  season: number
  /** 台帳に新しく入った数 = 積立が作られた記録の数 */
  created: number
  /** 既に台帳にあって見送った数 */
  known: number
  /** 新しく入った記録の内容 */
  titles: string[]
  /** ホームに出すカウントダウンの件数 */
  upcoming: number
  /** 読めなかったページなど。処理は続けるが残しておく */
  warnings: string[]
}

type SourcePageRow = { kind: string; html: string }
type SnapshotRow = { as_of: string; kind: string; player_name: string; stats: unknown }

const CAREER_PAGES: { kind: string; parseAs: 'batting' | 'pitching' | 'team' }[] = [
  { kind: 'milestone_batting', parseAs: 'batting' },
  { kind: 'milestone_pitching', parseAs: 'pitching' },
  { kind: 'milestone_team', parseAs: 'team' },
]

/** 記録を一意に指す文字列。区切りは記録名にも選手名にも出てこないものにする */
function milestoneKey(m: Milestone): string {
  return [m.kind, m.recordLabel, m.holder].join(' / ')
}

/**
 * 成績のスナップショットを古い順に見て、節目を初めて越えた日を達成日とする。
 *
 * 最新の1日だけを見ると、仕組みを足す前に越えていた記録が「今日の達成」に
 * なってしまい、月がずれる。履歴を持っているので、越えた最初の日を採る。
 */
function seasonMilestonesFromHistory(rows: SnapshotRow[]): Milestone[] {
  const byDate = new Map<string, Map<'batting' | 'pitching', StatSnapshot>>()

  for (const row of rows) {
    if (row.kind !== 'batting' && row.kind !== 'pitching') continue
    const stats = row.stats
    if (!stats || typeof stats !== 'object') continue

    const perKind = byDate.get(row.as_of) ?? new Map<'batting' | 'pitching', StatSnapshot>()
    const snapshot: StatSnapshot = perKind.get(row.kind) ?? {
      asOf: row.as_of,
      columns: [],
      rows: [],
      skipped: 0,
    }
    snapshot.rows.push({
      playerName: row.player_name,
      isLeft: false,
      stats: stats as Record<string, number>,
    })
    perKind.set(row.kind, snapshot)
    byDate.set(row.as_of, perKind)
  }

  // 同じ記録が何日も続けて出るので、最初に出た日だけを残す
  const first = new Map<string, Milestone>()
  for (const asOf of [...byDate.keys()].sort()) {
    for (const [kind, snapshot] of byDate.get(asOf)!) {
      for (const milestone of parseSeasonMilestones(snapshot, kind)) {
        const key = milestoneKey(milestone)
        if (!first.has(key)) first.set(key, milestone)
      }
    }
  }

  return [...first.values()]
}

/** 最新の基準日の成績を、選手名（空白を落としたもの）で引ける形にする */
function latestStatsByPlayer(
  rows: SnapshotRow[],
  kind: 'batting' | 'pitching'
): Map<string, Record<string, number>> {
  const ofKind = rows.filter((r) => r.kind === kind)
  const latest = ofKind.reduce((max, r) => (r.as_of > max ? r.as_of : max), '')

  const out = new Map<string, Record<string, number>>()
  for (const row of ofKind) {
    if (row.as_of !== latest) continue
    if (!row.stats || typeof row.stats !== 'object') continue
    out.set(row.player_name.replace(/[\s\u3000]+/g, ''), row.stats as Record<string, number>)
  }
  return out
}

/**
 * ホームに出すカウントダウンを作り直す。
 *
 * その年の残りを出すものなので履歴は持たない。毎回まるごと入れ替える。
 * npb.jp の並びが変わっても、古い行が残らないようにするため。
 */
async function refreshUpcoming(
  supabase: Admin,
  season: number,
  roster: RosterEntry[],
  htmlOf: (kind: string) => string | null,
  snapshots: SnapshotRow[],
  warnings: string[]
): Promise<number> {
  const pages: { kind: string; parseAs: 'batting' | 'pitching' }[] = [
    { kind: 'milestone_batting', parseAs: 'batting' },
    { kind: 'milestone_pitching', parseAs: 'pitching' },
  ]

  const rows: Record<string, unknown>[] = []

  for (const page of pages) {
    const html = htmlOf(page.kind)
    if (!html) continue
    try {
      const stats = latestStatsByPlayer(snapshots, page.parseAs)
      for (const item of parseUpcomingMilestones(html, page.parseAs, stats)) {
        rows.push({
          season,
          kind: item.kind,
          record_label: item.recordLabel,
          holder: item.holder,
          uniform_number: uniformNumberOf(roster, item.holder),
          target: item.target,
          unit: item.unit,
          current: item.current,
          remaining: item.remaining,
          updated_at: new Date().toISOString(),
        })
      }
    } catch (cause) {
      warnings.push(
        `${page.kind} のカウントダウンを作れませんでした: ${
          cause instanceof Error ? cause.message : String(cause)
        }`
      )
    }
  }

  // 空になったときに古い行を残さない。入れ替えなので先に消す
  const { error: deleteError } = await supabase
    .from('npb_upcoming_milestones')
    .delete()
    .eq('season', season)

  if (deleteError) {
    warnings.push(`カウントダウンを消せませんでした: ${deleteError.message}`)
    return 0
  }

  if (rows.length === 0) return 0

  const { error } = await supabase.from('npb_upcoming_milestones').insert(rows)
  if (error) {
    warnings.push(`カウントダウンを保存できませんでした: ${error.message}`)
    return 0
  }
  return rows.length
}

export async function registerMilestones(
  supabase: Admin,
  season: number
): Promise<MilestoneRegisterResult> {
  const warnings: string[] = []

  const { data: pages, error: pageError } = await supabase
    .from('npb_source_pages')
    .select('kind, html')
    .eq('season', season)

  if (pageError) throw new Error(`取得ページを読めませんでした: ${pageError.message}`)

  const htmlOf = (kind: string): string | null =>
    ((pages ?? []) as SourcePageRow[]).find((p) => p.kind === kind)?.html ?? null

  // 名鑑は年で分かれないが、保存するときに取得年を入れている。
  // 年をまたいだ直後に空にならないよう、年の指定なしでも引き直す
  let rosterHtml = htmlOf('roster')
  if (!rosterHtml) {
    const { data } = await supabase
      .from('npb_source_pages')
      .select('html')
      .eq('kind', 'roster')
      .maybeSingle()
    rosterHtml = (data as { html: string } | null)?.html ?? null
  }

  let roster: RosterEntry[] = []
  if (rosterHtml) {
    roster = parseRoster(rosterHtml)
    if (roster.length === 0) warnings.push('選手名鑑から背番号を取れませんでした')
  } else {
    warnings.push('選手名鑑がまだ取れていません。内容に背番号が入りません')
  }

  const found: Milestone[] = []

  for (const page of CAREER_PAGES) {
    const html = htmlOf(page.kind)
    if (!html) {
      warnings.push(`${page.kind} のページがまだ取れていません`)
      continue
    }
    try {
      found.push(...parseCareerMilestones(html, page.parseAs))
    } catch (cause) {
      warnings.push(
        `${page.kind} を読めませんでした: ${cause instanceof Error ? cause.message : String(cause)}`
      )
    }
  }

  const { data: snapshots, error: snapshotError } = await supabase
    .from('npb_player_stat_snapshots')
    .select('as_of, kind, player_name, stats')
    .gte('as_of', `${season}-01-01`)
    .lte('as_of', `${season}-12-31`)

  const snapshotRows = (snapshots ?? []) as SnapshotRow[]

  if (snapshotError) {
    warnings.push(`個人成績を読めませんでした: ${snapshotError.message}`)
  } else {
    found.push(...seasonMilestonesFromHistory(snapshotRows))
  }

  // ホームのカウントダウン。達成の登録とは別に、毎回作り直す
  const upcoming = await refreshUpcoming(supabase, season, roster, htmlOf, snapshotRows, warnings)

  if (found.length === 0) {
    return { season, created: 0, known: 0, titles: [], upcoming, warnings }
  }

  const rows = found.map((m) => {
    const number = uniformNumberOf(roster, m.holder)
    return {
      season,
      source: m.source,
      kind: m.kind,
      record_label: m.recordLabel,
      holder: m.holder,
      uniform_number: number,
      tier: m.tier,
      achieved_on: m.achievedOn,
      title: milestoneTitle(m, number),
    }
  })

  // 既にある記録には触らない。達成日や内容をあとから書き換えると、
  // 既に積み立てた分と食い違う
  const { data: inserted, error: insertError } = await supabase
    .from('npb_milestones')
    .upsert(rows, {
      onConflict: 'season,source,record_label,holder',
      ignoreDuplicates: true,
    })
    .select('title')

  if (insertError) throw new Error(`記録を登録できませんでした: ${insertError.message}`)

  const titles = ((inserted ?? []) as { title: string }[]).map((r) => r.title)

  return {
    season,
    created: titles.length,
    known: rows.length - titles.length,
    titles,
    upcoming,
    warnings,
  }
}
