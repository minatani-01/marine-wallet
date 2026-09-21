/**
 * npb.jp からの取得と保存。
 *
 * この段階では既存の games には触れない。npb_games と
 * npb_player_stat_snapshots に貯めるだけにする。
 * 数日分たまってから、差分計算の結果を手入力のデータと突き合わせて
 * 検証したうえで games への反映をつなぐ（docs/npb-data-sources.md 5.3）。
 */

import {
  FETCH_INTERVAL_MS,
  MARINES_TEAM_LABEL,
  battingStatsUrl,
  boxScoreUrl,
  fetchNpbPage,
  pitchingStatsUrl,
  scheduleUrl,
  sleep,
} from './fetch'
import { parseBoxScore } from './boxscore'
import { gamesOf, losePitcherOf, parseSchedule, winPitcherOf, type ScheduleGame } from './schedule'
import { parseTeamStats, type StatSnapshot } from './stats'
import { leagueRows, type LeagueGameRow } from './league'

/** ページ取得を差し替えられるようにしておく（テストで実際の通信をしないため） */
export type PageFetcher = (url: string) => Promise<string>

export type NpbGameRow = {
  game_date: string
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  place: string
  start_time: string
  phase: string
  status: string
  win_pitcher: string
  lose_pitcher: string
  save_pitcher: string
  box_score_path: string
  note: string
  raw: Record<string, unknown>
}

export type SnapshotRow = {
  as_of: string
  kind: 'batting' | 'pitching'
  player_name: string
  is_left: boolean
  stats: Record<string, number>
}

export type SyncResult = {
  /** 取得したページ数 */
  pages: number
  games: NpbGameRow[]
  /**
   * 12球団すべての試合（順位の計算に使う）。
   * 日程ページは1枚で全球団ぶんが載っているので、取得は増えない
   */
  leagueGames: LeagueGameRow[]
  snapshots: SnapshotRow[]
  /** スナップショットの基準日。打撃と投手で違えば警告になる */
  battingAsOf: string | null
  pitchingAsOf: string | null
  /** 見つけた問題。処理は続けるが、あとで見直せるように残す */
  warnings: string[]
}

function toGameRow(game: ScheduleGame, phase: string, box: ReturnType<typeof parseBoxScore> | null): NpbGameRow {
  return {
    game_date: game.gameDate,
    home_team: game.homeTeam,
    away_team: game.awayTeam,
    home_score: game.homeScore,
    away_score: game.awayScore,
    place: game.place,
    start_time: game.startTime,
    phase,
    status: game.status,
    // ボックススコアがあればそちらを正とする。日程表は略称のことがある
    win_pitcher: box?.winPitcher || winPitcherOf(game),
    lose_pitcher: box?.losePitcher || losePitcherOf(game),
    save_pitcher: box?.savePitcher ?? '',
    box_score_path: game.boxScorePath,
    note: game.note,
    raw: {
      schedule: { pitchers: game.pitchers },
      box: box
        ? {
            seriesLabel: box.seriesLabel,
            state: box.state,
            homeRuns: box.homeRuns,
          }
        : null,
    },
  }
}

function toSnapshotRows(snap: StatSnapshot, kind: 'batting' | 'pitching'): SnapshotRow[] {
  if (!snap.asOf) return []
  return snap.rows.map((r) => ({
    as_of: snap.asOf!,
    kind,
    player_name: r.playerName,
    is_left: r.isLeft,
    stats: r.stats,
  }))
}

/**
 * 先の予定を取りに行く月。
 *
 * 当月だけだと、月末には次の試合が数日ぶんしか分からない。翌月も取って
 * おけば、ひと月以上先まで見える。シーズン中（3〜10月）だけにして、
 * 試合の無い月を取りに行かない。
 */
export function scheduleMonths(year: number, month: number): { year: number; month: number }[] {
  const months = [{ year, month }]
  if (month >= 3 && month <= 10) months.push({ year, month: month + 1 })
  return months
}

/** 同じ試合を二度入れない。月をまたいで同じページに載ることがある */
function dedupe<T extends { gameDate: string; homeTeam: string; awayTeam: string; startTime: string }>(
  games: T[]
): T[] {
  const seen = new Map<string, T>()
  for (const game of games) {
    seen.set(`${game.gameDate}|${game.homeTeam}|${game.awayTeam}|${game.startTime}`, game)
  }
  return [...seen.values()]
}

/**
 * 1回分の取得を行う。
 *
 * 取るページは次の5つまで。
 *   1. 当月の日程・結果
 *   2. 翌月の日程・結果（先の予定と、中止の知らせを早めに拾うため）
 *   3. 直近で終わったマリーンズ戦のボックススコア（1件）
 *   4. 個人打撃成績
 *   5. 個人投手成績
 *
 * 日程ページは終わった試合も、これからの試合も、中止も同じ表に載る。
 * 取り込みは上書きなので、雨天中止や開始時刻の変更は次の朝に反映される。
 *
 * @param today 実行日。ここから対象の年月を決める
 */
export async function runNpbSync(
  today: Date,
  fetchPage: PageFetcher = fetchNpbPage
): Promise<SyncResult> {
  const warnings: string[] = []
  let pages = 0

  const year = today.getFullYear()
  const month = today.getMonth() + 1

  // 1-2. 当月と翌月の日程・結果。これからの試合と中止もここに載る
  const schedule: ScheduleGame[] = []
  for (const [index, target] of scheduleMonths(year, month).entries()) {
    if (index > 0) await sleep(FETCH_INTERVAL_MS)
    try {
      const html = await fetchPage(scheduleUrl(target.year, target.month))
      pages += 1
      schedule.push(...parseSchedule(html, target.year))
    } catch (cause) {
      // 翌月のページがまだ無いことがある。当月が取れていれば続ける
      warnings.push(
        `${target.year}年${target.month}月の日程を取得できませんでした: ${String(cause)}`
      )
    }
  }

  const allGames = dedupe(schedule)
  const marinesGames = gamesOf(allGames, MARINES_TEAM_LABEL)
  if (marinesGames.length === 0) {
    warnings.push(`${year}年${month}月の日程にマリーンズの試合が見つかりませんでした`)
  }

  // 2. 直近で終わった試合のボックススコア。
  //    フェーズと、日程表に出ないセーブ投手はここからしか取れない。
  const finished = marinesGames.filter((g) => g.status === 'finished' && g.boxScorePath)
  const latest = finished.length > 0 ? finished[finished.length - 1] : null

  let latestBox: ReturnType<typeof parseBoxScore> | null = null
  if (latest) {
    await sleep(FETCH_INTERVAL_MS)
    try {
      const boxHtml = await fetchPage(boxScoreUrl(latest.boxScorePath))
      pages += 1
      latestBox = parseBoxScore(boxHtml)
      if (latestBox.gameDate && latestBox.gameDate !== latest.gameDate) {
        warnings.push(
          `ボックススコアの日付が日程と一致しません（日程 ${latest.gameDate} / ボックス ${latestBox.gameDate}）`
        )
        latestBox = null
      }
    } catch (cause) {
      warnings.push(`ボックススコアを取得できませんでした: ${String(cause)}`)
    }
  }

  const games = marinesGames.map((g) =>
    toGameRow(g, latest && g.gameDate === latest.gameDate && latestBox ? latestBox.phase : 'regular',
      latest && g.gameDate === latest.gameDate ? latestBox : null)
  )

  // 3-4. 個人成績のスナップショット
  await sleep(FETCH_INTERVAL_MS)
  const battingHtml = await fetchPage(battingStatsUrl(year))
  pages += 1
  const batting = parseTeamStats(battingHtml, 'batting')

  await sleep(FETCH_INTERVAL_MS)
  const pitchingHtml = await fetchPage(pitchingStatsUrl(year))
  pages += 1
  const pitching = parseTeamStats(pitchingHtml, 'pitching')

  if (batting.skipped > 0) warnings.push(`打撃成績で ${batting.skipped} 行を読み飛ばしました`)
  if (pitching.skipped > 0) warnings.push(`投手成績で ${pitching.skipped} 行を読み飛ばしました`)
  if (!batting.asOf) warnings.push('打撃成績の基準日を読めませんでした')
  if (!pitching.asOf) warnings.push('投手成績の基準日を読めませんでした')
  if (batting.asOf && pitching.asOf && batting.asOf !== pitching.asOf) {
    warnings.push(
      `打撃と投手で基準日が違います（打撃 ${batting.asOf} / 投手 ${pitching.asOf}）`
    )
  }

  return {
    pages,
    games,
    leagueGames: leagueRows(allGames),
    snapshots: [...toSnapshotRows(batting, 'batting'), ...toSnapshotRows(pitching, 'pitching')],
    battingAsOf: batting.asOf,
    pitchingAsOf: pitching.asOf,
    warnings,
  }
}
