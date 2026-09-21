import { FETCH_INTERVAL_MS, MARINES_TEAM_LABEL, fetchNpbPage, scheduleUrl, sleep } from './fetch'
import { gamesOf, parseSchedule, withCancelled, type ScheduleGame } from './schedule'
import { dedupe, scheduleMonths } from './sync'
import { leagueRows, saveLeagueGames } from './league'
import { jstDate } from '@/lib/jst'
import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * 日程だけを取り直す。
 *
 * 毎朝の取り込みは1日1回で、その間に決まった中止は翌朝まで入らない。
 * 中止は当日に決まるものなので、押したときに取り直せる口を作る。
 *
 * 取りに行くのは当月と翌月の日程ページの2枚だけ。成績もボックススコアも
 * 見ない。日程の上書きだけが目的で、金額に効く項目には触らない。
 *
 * npb_games は入れ替えではなく、日程まわりの項目だけを直す。
 * 行ごと入れ替えると、ボックススコアから入れたセーブ投手やフェーズまで
 * 消えてしまう。変わった行だけを直すので、普段は1〜2行しか書かない。
 */

type Admin = ReturnType<typeof createAdminClient>

/** 日程ページから直す項目。得点・状態・備考・時刻・球場だけ */
type ScheduleFields = {
  home_score: number | null
  away_score: number | null
  status: string
  note: string
  start_time: string
  place: string
  box_score_path: string
}

type ExistingRow = ScheduleFields & { game_date: string; home_team: string; away_team: string }

function fieldsOf(game: ScheduleGame): ScheduleFields {
  return {
    home_score: game.homeScore,
    away_score: game.awayScore,
    status: game.status,
    note: game.note,
    start_time: game.startTime,
    place: game.place,
    box_score_path: game.boxScorePath,
  }
}

/** 中身が変わったかどうか。変わっていない行は書かない */
export function changed(before: ScheduleFields, after: ScheduleFields): boolean {
  return (
    before.home_score !== after.home_score ||
    before.away_score !== after.away_score ||
    before.status !== after.status ||
    before.note !== after.note ||
    before.start_time !== after.start_time ||
    before.place !== after.place ||
    before.box_score_path !== after.box_score_path
  )
}

export type ScheduleRefreshResult = {
  /** 取りに行った月 */
  months: string[]
  /** 直した試合 */
  updated: { game_date: string; status: string; note: string }[]
  /** 新しく入れた試合の数（翌月ぶんなど） */
  added: number
  /** 12球団ぶんに入れた試合の数 */
  league: number
}

export async function refreshSchedule(
  supabase: Admin,
  now: Date,
  fetchPage: (url: string) => Promise<string> = fetchNpbPage
): Promise<ScheduleRefreshResult> {
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const months = scheduleMonths(year, month)

  const parsed: ScheduleGame[] = []
  for (const [index, target] of months.entries()) {
    if (index > 0) await sleep(FETCH_INTERVAL_MS)
    try {
      const html = await fetchPage(scheduleUrl(target.year, target.month))
      parsed.push(...parseSchedule(html, target.year))
    } catch {
      // 翌月のページがまだ無いことがある。当月が取れていれば続ける
    }
  }

  const all = withCancelled(dedupe(parsed), jstDate(now))
  const league = await saveLeagueGames(supabase, leagueRows(all))

  const marines = gamesOf(all, MARINES_TEAM_LABEL)
  const dates = marines.map((g) => g.gameDate)

  const { data, error } = await supabase
    .from('npb_games')
    .select(
      'game_date, home_team, away_team, home_score, away_score, status, note, start_time, place, box_score_path'
    )
    .in('game_date', dates.length > 0 ? dates : ['1900-01-01'])
  if (error) throw new Error(`取得データを読めませんでした: ${error.message}`)

  const existing = new Map<string, ExistingRow>()
  for (const row of (data ?? []) as ExistingRow[]) {
    existing.set(`${row.game_date}|${row.home_team}|${row.away_team}`, row)
  }

  const updated: ScheduleRefreshResult['updated'] = []
  const fresh: Record<string, unknown>[] = []

  for (const game of marines) {
    const key = `${game.gameDate}|${game.homeTeam}|${game.awayTeam}`
    const after = fieldsOf(game)
    const before = existing.get(key)

    if (!before) {
      // まだ無い試合。日程から分かるぶんだけで作る
      fresh.push({
        game_date: game.gameDate,
        home_team: game.homeTeam,
        away_team: game.awayTeam,
        ...after,
        phase: 'regular',
        win_pitcher: '',
        lose_pitcher: '',
        save_pitcher: '',
        raw: { schedule: { pitchers: game.pitchers } },
      })
      continue
    }

    if (!changed(before, after)) continue

    const { error: updateError } = await supabase
      .from('npb_games')
      .update(after)
      .eq('game_date', game.gameDate)
      .eq('home_team', game.homeTeam)
      .eq('away_team', game.awayTeam)
    if (updateError) throw new Error(`試合を直せませんでした: ${updateError.message}`)

    updated.push({ game_date: game.gameDate, status: after.status, note: after.note })
  }

  if (fresh.length > 0) {
    const { error: insertError } = await supabase.from('npb_games').insert(fresh)
    if (insertError) throw new Error(`試合を追加できませんでした: ${insertError.message}`)
  }

  return {
    months: months.map((m) => `${m.year}-${String(m.month).padStart(2, '0')}`),
    updated,
    added: fresh.length,
    league,
  }
}
