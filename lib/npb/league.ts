import { FETCH_INTERVAL_MS, fetchNpbPage, scheduleUrl, sleep } from './fetch'
import { parseSchedule, withCancelled, type ScheduleGame } from './schedule'
import { standingsOf, type LeagueGame } from './standings'
import { jstDate } from '@/lib/jst'
import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * 12球団すべての試合を貯めて、順位を出す。
 *
 * 日程ページには12球団の試合が載っていて、毎朝すでに取っている。
 * これまでマリーンズ以外の行は捨てていた。残すだけで順位が出せるので、
 * npb.jp へ取りに行くページは増えない。
 *
 * 貯める先は npb_league_games で、npb_games とは分けてある。あちらは
 * 「前日の1試合」を見て貯金に入れる入口で、1日に複数行あると人の
 * 確認待ちになる（register.ts）。混ぜると毎日それに当たる。
 */

type Admin = ReturnType<typeof createAdminClient>

/** 1回で取りに行く月の数。Vercel の実行時間に収まる範囲にする */
export const LEAGUE_MONTH_LIMIT = 3

export type LeagueGameRow = {
  game_date: string
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  start_time: string
  status: string
  note: string
}

/** 日程ページの1試合を、貯める形にする */
export function leagueRows(games: ScheduleGame[]): LeagueGameRow[] {
  return games.map((g) => ({
    game_date: g.gameDate,
    home_team: g.homeTeam,
    away_team: g.awayTeam,
    home_score: g.homeScore,
    away_score: g.awayScore,
    start_time: g.startTime,
    status: g.status,
    note: g.note,
  }))
}

/** 貯める。同じ試合は上書きする（得点は日をまたいで確定することがある） */
export async function saveLeagueGames(supabase: Admin, rows: LeagueGameRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const { error } = await supabase
    .from('npb_league_games')
    .upsert(
      rows.map((row) => ({ ...row, updated_at: new Date().toISOString() })),
      { onConflict: 'game_date,home_team,away_team,start_time' }
    )
  if (error) throw new Error(`リーグの試合を保存できませんでした: ${error.message}`)
  return rows.length
}

/** 'YYYY-MM-DD' の並びから、月（'YYYY-MM'）の集合を作る */
export function monthsOf(dates: { game_date: string }[]): Set<string> {
  return new Set(dates.map((r) => r.game_date.slice(0, 7)))
}

/**
 * 順位を出せる状態かどうか。
 *
 * マリーンズの試合がある月のうち、12球団ぶんを取れていない月があれば
 * 出せない。9月ぶんだけで数えると「6位・首位と5ゲーム差」のような、
 * それらしいが間違った順位が出る。空欄のほうがまだよい。
 */
export function missingMonths(want: Set<string>, have: Set<string>): string[] {
  return [...want].filter((month) => !have.has(month)).sort()
}

export type CollectLeagueResult = {
  /** 取りに行った月 */
  months: string[]
  saved: number
  /** まだ取っていない月の数。0になるまで押せばよい */
  remaining: number
}

/**
 * まだ貯めていない月の日程を取りに行く。
 *
 * 毎朝の取り込みは当月ぶんしか見ないので、仕組みを入れる前の月は空のまま。
 * それを埋めるための、人が押して動かす処理。相手に負担をかけないよう
 * 1回に取る月を絞り、間隔を空ける。
 *
 * 対象は「マリーンズの試合がある月」。npb_games に入っている月を見て決める。
 */
export async function collectLeagueMonths(
  supabase: Admin,
  season: number,
  fetchPage: (url: string) => Promise<string> = fetchNpbPage,
  limit = LEAGUE_MONTH_LIMIT
): Promise<CollectLeagueResult> {
  const { data: npb, error: npbError } = await supabase
    .from('npb_games')
    .select('game_date')
    .gte('game_date', `${season}-01-01`)
    .lte('game_date', `${season}-12-31`)
  if (npbError) throw new Error(`取得データを読めませんでした: ${npbError.message}`)

  const { data: have, error: haveError } = await supabase
    .from('npb_league_games')
    .select('game_date')
    .gte('game_date', `${season}-01-01`)
    .lte('game_date', `${season}-12-31`)
  if (haveError) throw new Error(`リーグの試合を読めませんでした: ${haveError.message}`)

  const want = monthsOf((npb ?? []) as { game_date: string }[])
  const done = monthsOf((have ?? []) as { game_date: string }[])

  const missing = missingMonths(want, done)
  const targets = missing.slice(0, limit)

  let saved = 0
  for (const [index, month] of targets.entries()) {
    if (index > 0) await sleep(FETCH_INTERVAL_MS)
    const html = await fetchPage(scheduleUrl(season, Number(month.slice(5, 7))))
    const games = withCancelled(parseSchedule(html, season), jstDate(new Date()))
    saved += await saveLeagueGames(supabase, leagueRows(games))
  }

  return { months: targets, saved, remaining: missing.length - targets.length }
}

/**
 * 貯めた試合から順位を出して入れ替える。
 *
 * 毎回すべて計算し直す。足していく作りにすると、あとから得点が直ったときに
 * 数がずれたままになり、どこで狂ったのかを追えなくなる。
 */
export async function refreshStandings(
  supabase: Admin,
  season: number
): Promise<{ teams: number; asOf: string | null; missing?: string[] }> {
  const { data, error } = await supabase
    .from('npb_league_games')
    .select('game_date, home_team, away_team, home_score, away_score, status, note')
    .gte('game_date', `${season}-01-01`)
    .lte('game_date', `${season}-12-31`)
  if (error) throw new Error(`リーグの試合を読めませんでした: ${error.message}`)

  // 途中の月が欠けたまま数えない。それらしく見えて間違った順位が出る
  const { data: npb, error: npbError } = await supabase
    .from('npb_games')
    .select('game_date')
    .gte('game_date', `${season}-01-01`)
    .lte('game_date', `${season}-12-31`)
  if (npbError) throw new Error(`取得データを読めませんでした: ${npbError.message}`)

  const missing = missingMonths(
    monthsOf((npb ?? []) as { game_date: string }[]),
    monthsOf((data ?? []) as { game_date: string }[])
  )
  if (missing.length > 0) return { teams: 0, asOf: null, missing }

  const games = (data ?? []) as LeagueGame[]
  const rows = [...standingsOf(games, 'p'), ...standingsOf(games, 'c')].map((row) => ({
    season,
    team: row.team,
    league: row.league,
    win: row.win,
    lose: row.lose,
    draw: row.draw,
    rate: row.rate,
    rank: row.rank,
    games_behind: row.games_behind,
    as_of: row.as_of,
    updated_at: new Date().toISOString(),
  }))

  const { error: saveError } = await supabase
    .from('npb_standings')
    .upsert(rows, { onConflict: 'season,team' })
  if (saveError) throw new Error(`順位を保存できませんでした: ${saveError.message}`)

  const asOf = rows.reduce<string | null>(
    (latest, row) => (row.as_of && (!latest || row.as_of > latest) ? row.as_of : latest),
    null
  )
  return { teams: rows.length, asOf }
}
