/**
 * リーグ順位の計算。
 *
 * npb.jp は順位表のページも出しているが、そこは取りに行かない。
 * 日程ページ（12球団すべての試合が載っている）を毎朝すでに取っており、
 * 勝敗を数えれば同じものが出る。取りに行くページは少ないほどよい。
 *
 * 勝率は引き分けを除いて 勝 ÷（勝＋負）。NPB の表記に合わせて小数第3位まで。
 * 同率は同じ順位にする（並びの前後で順位が入れ替わって見えないように）。
 */

/** 日程ページの表記。lib/constants.ts の OPPONENTS と揃える */
export const PACIFIC_TEAMS = [
  'ロッテ',
  'ソフトバンク',
  '日本ハム',
  'オリックス',
  '楽天',
  '西武',
] as const

export const CENTRAL_TEAMS = [
  '阪神',
  '巨人',
  'DeNA',
  '広島',
  'ヤクルト',
  '中日',
] as const

export type League = 'p' | 'c'

export function leagueOf(team: string): League | null {
  if ((PACIFIC_TEAMS as readonly string[]).includes(team)) return 'p'
  if ((CENTRAL_TEAMS as readonly string[]).includes(team)) return 'c'
  return null
}

/**
 * 順位に入れない試合の印。
 *
 * 日程ページの備考に入る。ポストシーズンとオープン戦を混ぜると、
 * 順位表の勝敗と合わなくなる。取りこぼしても順位が大きく動くのは
 * シーズンが終わったあとだけなので、印での判定にとどめる。
 */
const EXCLUDED_MARKERS = ['クライマックス', 'ＣＳ', '日本シリーズ', 'オープン戦', 'ファーム']

export type LeagueGame = {
  game_date: string
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  status: string
  note: string
}

export type Standing = {
  team: string
  league: League
  win: number
  lose: number
  draw: number
  /** 勝率。勝敗が1つも無ければ null */
  rate: number | null
  rank: number
  /** 首位とのゲーム差。首位は 0 */
  games_behind: number
  /** 集計に入れた最後の試合日 */
  as_of: string | null
}

/** 順位に数える試合かどうか */
export function countable(game: LeagueGame): boolean {
  if (game.status !== 'finished') return false
  if (game.home_score === null || game.away_score === null) return false
  if (leagueOf(game.home_team) === null || leagueOf(game.away_team) === null) return false
  return !EXCLUDED_MARKERS.some((marker) => game.note.includes(marker))
}

/** ゲーム差。((首位の勝 - 勝) + (負 - 首位の負)) / 2 */
function gamesBehind(leader: { win: number; lose: number }, team: { win: number; lose: number }) {
  const diff = (leader.win - team.win + (team.lose - leader.lose)) / 2
  // -0 を出さない。0.5 刻みなので小数第1位まで
  return Math.round(Math.max(diff, 0) * 10) / 10
}

/**
 * 1リーグぶんの順位を出す。
 *
 * 試合が1つも無いチームも 0勝0敗 で並べる。開幕前に順位が消えるより、
 * 全球団が並んでいるほうが分かりやすい。
 */
export function standingsOf(games: LeagueGame[], league: League): Standing[] {
  const teams = league === 'p' ? PACIFIC_TEAMS : CENTRAL_TEAMS
  const tally = new Map<string, { win: number; lose: number; draw: number; as_of: string | null }>()
  for (const team of teams) tally.set(team, { win: 0, lose: 0, draw: 0, as_of: null })

  for (const game of games) {
    if (!countable(game)) continue

    const home = game.home_score as number
    const away = game.away_score as number

    for (const [team, score, other] of [
      [game.home_team, home, away],
      [game.away_team, away, home],
    ] as [string, number, number][]) {
      const row = tally.get(team)
      if (!row) continue
      if (score > other) row.win += 1
      else if (score < other) row.lose += 1
      else row.draw += 1
      if (!row.as_of || game.game_date > row.as_of) row.as_of = game.game_date
    }
  }

  const rows = teams.map((team) => {
    const t = tally.get(team)!
    const decided = t.win + t.lose
    return {
      team,
      league,
      win: t.win,
      lose: t.lose,
      draw: t.draw,
      rate: decided === 0 ? null : Math.round((t.win / decided) * 1000) / 1000,
      rank: 0,
      games_behind: 0,
      as_of: t.as_of,
    }
  })

  // 勝率の高い順。まだ1試合も終わっていないチームは最後に置く。
  // 0.000（負けただけ）と、まだ分からないものを同じには扱わない
  const key = (row: { rate: number | null }) => row.rate ?? -1
  rows.sort((a, b) => key(b) - key(a) || b.win - a.win)

  const leader = rows[0]
  let rank = 0
  let previous: number | null = null
  rows.forEach((row, index) => {
    if (previous === null || key(row) !== previous) rank = index + 1
    previous = key(row)
    row.rank = rank
    row.games_behind = gamesBehind(leader, row)
  })

  return rows
}
