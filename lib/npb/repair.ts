import { FETCH_INTERVAL_MS, MARINES_TEAM_LABEL, fetchNpbPage, scheduleUrl, sleep } from '@/lib/npb/fetch'
import { factsFromNpb, type GameFacts, type NpbGameSource } from '@/lib/npb/import'
import { gamesOf, losePitcherOf, parseSchedule, winPitcherOf } from '@/lib/npb/schedule'
import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * すでに登録してある試合を、npb.jp の内容に合わせて直す。
 *
 * 手で入れた試合には、ホーム・ビジターや得点が入っていないものがある。
 * 記録の一覧が寂しくなるだけでなく、あとから見返したときに何の試合だったか
 * 分からない。取れるものは取って埋める。
 *
 * ただし金額は動かさない。直すのは金額の計算に入らない項目だけにする。
 *
 *   直す   対戦相手 / ホーム・ビジター / 球場 / 自軍の得点 / 相手の得点
 *   直さない 勝敗 / フェーズ / 本塁打 / 投手の記録 / その他ボーナス
 *
 * 勝敗は金額そのものなので、食い違っていても書き換えず、知らせるだけにする。
 * フェーズは日程表から取れない（毎朝の取り込みは直近の1試合ぶんしか
 * ボックススコアを見ないので、それ以外は一律 regular で入る）。
 * 交流戦を regular に塗り替えてしまうため、比べることすらしない。
 */

type Admin = ReturnType<typeof createAdminClient>

/** 1回で取りに行く月の上限。Vercel の実行時間に収まる範囲にする */
export const MONTH_LIMIT = 3

export type CollectResult = {
  /** 取りに行った月（YYYY-MM） */
  months: string[]
  /** npb_games に入った試合数 */
  saved: number
  /** まだ取れていない月の数 */
  remaining: number
  warnings: string[]
}

export type RepairChange = {
  game_date: string
  field: keyof GameFacts
  before: string | number | null
  after: string | number
}

export type RepairMismatch = {
  game_date: string
  /** 金額に関わるので直さない。人が見て決める */
  field: 'result'
  current: string
  npb: string
}

export type RepairResult = {
  /** 見に行った試合数 */
  checked: number
  /** 実際に直した試合数 */
  updated: number
  changes: RepairChange[]
  mismatches: RepairMismatch[]
  /** 直せなかった試合の理由 */
  skipped: { game_date: string; reason: string }[]
}

type GameRow = {
  id: string
  game_date: string
  opponent: string
  home_away: string | null
  stadium: string
  marines_score: number | null
  opponent_score: number | null
  result: string
}

type NpbRow = {
  game_date: string
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  place: string
  phase: string
  status: string
  save_pitcher: string
}

// ----------------------------------------------------------------------------
// 足りない月の日程を取ってくる
// ----------------------------------------------------------------------------

/**
 * `games` に試合があるのに取得データが無い月の、日程・結果ページを取る。
 *
 * 毎朝の取り込みは当月しか見ない。仕組みを作る前の月は取得データが無く、
 * 直しようがないので、ここで月単位に取りに行く。
 * 1回で取る月数に上限を置く。足りなければもう一度押せばよい。
 */
export async function collectMissingMonths(
  supabase: Admin,
  season: number,
  fetchPage: (url: string) => Promise<string> = fetchNpbPage
): Promise<CollectResult> {
  const warnings: string[] = []

  const { data: games, error: gamesError } = await supabase
    .from('games')
    .select('game_date')
    .gte('game_date', `${season}-01-01`)
    .lte('game_date', `${season}-12-31`)

  if (gamesError) throw new Error(`登録済みの試合を読めませんでした: ${gamesError.message}`)

  const { data: npb, error: npbError } = await supabase
    .from('npb_games')
    .select('game_date')
    .gte('game_date', `${season}-01-01`)
    .lte('game_date', `${season}-12-31`)

  if (npbError) throw new Error(`取得データを読めませんでした: ${npbError.message}`)

  const have = new Set(((npb ?? []) as { game_date: string }[]).map((r) => r.game_date.slice(0, 7)))
  const want = new Set(
    ((games ?? []) as { game_date: string }[]).map((r) => r.game_date.slice(0, 7))
  )

  const missing = [...want].filter((m) => !have.has(m)).sort()
  const targets = missing.slice(0, MONTH_LIMIT)

  let saved = 0

  for (const [index, month] of targets.entries()) {
    if (index > 0) await sleep(FETCH_INTERVAL_MS)

    try {
      const html = await fetchPage(scheduleUrl(season, Number(month.slice(5, 7))))
      const marines = gamesOf(parseSchedule(html, season), MARINES_TEAM_LABEL)

      if (marines.length === 0) {
        warnings.push(`${month} の日程にマリーンズの試合がありませんでした`)
        continue
      }

      const rows = marines.map((g) => ({
        game_date: g.gameDate,
        home_team: g.homeTeam,
        away_team: g.awayTeam,
        home_score: g.homeScore,
        away_score: g.awayScore,
        place: g.place,
        start_time: g.startTime,
        // 日程表にフェーズは載らない。ボックススコアを見ないと分からないので、
        // ここでは入れたことにしない（直しでもフェーズは見ない）
        phase: 'regular',
        status: g.status,
        win_pitcher: winPitcherOf(g),
        lose_pitcher: losePitcherOf(g),
        save_pitcher: '',
        box_score_path: g.boxScorePath,
        note: g.note,
        raw: { schedule: { pitchers: g.pitchers } },
      }))

      const { error } = await supabase
        .from('npb_games')
        .upsert(rows, { onConflict: 'game_date,home_team,away_team' })

      if (error) {
        warnings.push(`${month} を保存できませんでした: ${error.message}`)
        continue
      }
      saved += rows.length
    } catch (cause) {
      warnings.push(
        `${month} を取得できませんでした: ${cause instanceof Error ? cause.message : String(cause)}`
      )
    }
  }

  return { months: targets, saved, remaining: Math.max(0, missing.length - targets.length), warnings }
}

// ----------------------------------------------------------------------------
// 直す
// ----------------------------------------------------------------------------

/** 直す対象。ここに無い項目は触らない */
const REPAIRABLE: (keyof GameFacts)[] = [
  'opponent',
  'home_away',
  'stadium',
  'marines_score',
  'opponent_score',
]

export async function repairGames(supabase: Admin, season: number): Promise<RepairResult> {
  const { data: games, error: gamesError } = await supabase
    .from('games')
    .select('id, game_date, opponent, home_away, stadium, marines_score, opponent_score, result')
    .gte('game_date', `${season}-01-01`)
    .lte('game_date', `${season}-12-31`)
    .order('game_date', { ascending: true })

  if (gamesError) throw new Error(`登録済みの試合を読めませんでした: ${gamesError.message}`)

  const { data: npb, error: npbError } = await supabase
    .from('npb_games')
    .select('game_date, home_team, away_team, home_score, away_score, place, phase, status, save_pitcher')
    .eq('status', 'finished')
    .gte('game_date', `${season}-01-01`)
    .lte('game_date', `${season}-12-31`)

  if (npbError) throw new Error(`取得データを読めませんでした: ${npbError.message}`)

  // 日付ごとに数える。1日に2試合あると、どちらの試合か決められない
  const byDate = new Map<string, NpbRow[]>()
  for (const row of (npb ?? []) as NpbRow[]) {
    byDate.set(row.game_date, [...(byDate.get(row.game_date) ?? []), row])
  }

  const rows = (games ?? []) as GameRow[]
  const gameCountByDate = new Map<string, number>()
  for (const g of rows) gameCountByDate.set(g.game_date, (gameCountByDate.get(g.game_date) ?? 0) + 1)

  const changes: RepairChange[] = []
  const mismatches: RepairMismatch[] = []
  const skipped: { game_date: string; reason: string }[] = []
  let updated = 0

  for (const game of rows) {
    const candidates = byDate.get(game.game_date) ?? []

    if (candidates.length === 0) {
      skipped.push({ game_date: game.game_date, reason: '取得データがありません' })
      continue
    }
    // 同じ日に複数あるときは、取り違えると別の試合の内容を書いてしまう
    if (candidates.length > 1 || (gameCountByDate.get(game.game_date) ?? 0) > 1) {
      skipped.push({ game_date: game.game_date, reason: '同じ日に複数の試合があります' })
      continue
    }

    const source: NpbGameSource = { ...candidates[0], raw: null }
    const facts = factsFromNpb(source)
    if (!facts.ok) {
      skipped.push({ game_date: game.game_date, reason: facts.reason })
      continue
    }

    // 勝敗は金額そのもの。食い違っていても書き換えず、知らせるだけにする
    if (facts.facts.result !== game.result) {
      mismatches.push({
        game_date: game.game_date,
        field: 'result',
        current: game.result,
        npb: facts.facts.result,
      })
    }

    const patch: Record<string, string | number> = {}
    for (const field of REPAIRABLE) {
      const after = facts.facts[field]
      const before = game[field] as string | number | null
      // 空文字と null はどちらも「入っていない」。値が同じなら触らない
      if (before === after) continue
      patch[field] = after
      changes.push({ game_date: game.game_date, field, before, after })
    }

    if (Object.keys(patch).length === 0) continue

    const { error } = await supabase.from('games').update(patch).eq('id', game.id)
    if (error) {
      skipped.push({ game_date: game.game_date, reason: `直せませんでした: ${error.message}` })
      continue
    }
    updated += 1
  }

  return { checked: rows.length, updated, changes, mismatches, skipped }
}
