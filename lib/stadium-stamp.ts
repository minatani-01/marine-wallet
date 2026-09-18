import { HOME_STADIUMS, REGIONAL_STADIUMS, stadiumOf, type Stadium } from '@/lib/stadiums'
import type { Game, StadiumVisit } from '@/types'

/**
 * 球場スタンプの集計。
 *
 * DB も時計も触らない純関数にしてある。「行った球場」は金額ではないが、
 * 数え方を間違えると「行っていない球場にスタンプが付く」という、
 * 気付きにくい嘘になる。試合データと訪問記録を分けて扱い、
 * スタンプの根拠を訪問記録だけに置く。
 */

export type StadiumStamp = {
  stadium: Stadium
  visited: boolean
  /** 初めて行った日。行っていなければ null */
  firstVisit: string | null
  /** 行った回数 */
  visits: number
  /** そのうち試合を観た回数 */
  games: number
}

export type StampCard = {
  home: StadiumStamp[]
  regional: StadiumStamp[]
  /** 12球団の本拠地のうち行った数 */
  homeVisited: number
  /** 地方球場のうち行った数 */
  regionalVisited: number
}

function stampFor(stadium: Stadium, visits: StadiumVisit[]): StadiumStamp {
  const mine = visits.filter((v) => v.stadium_id === stadium.id)
  const dates = mine.map((v) => v.visited_on).sort()

  return {
    stadium,
    visited: mine.length > 0,
    firstVisit: dates[0] ?? null,
    visits: mine.length,
    games: mine.filter((v) => v.game_id !== null).length,
  }
}

export function buildStampCard(visits: StadiumVisit[]): StampCard {
  const home = HOME_STADIUMS.map((s) => stampFor(s, visits))
  const regional = REGIONAL_STADIUMS.map((s) => stampFor(s, visits))

  return {
    home,
    regional,
    homeVisited: home.filter((s) => s.visited).length,
    regionalVisited: regional.filter((s) => s.visited).length,
  }
}

/**
 * まだ「行った」を押していない試合。新しい順。
 *
 * 行った試合を1つずつ探すのは大変なので、こちらから候補を出す。
 * 球場をマスタに引けない試合は出さない（押されてもスタンプの付け先がない）。
 */
export function uncheckedGames(games: Game[], visits: StadiumVisit[]): Game[] {
  const checked = new Set(visits.map((v) => v.game_id).filter(Boolean) as string[])

  return games
    .filter((g) => !checked.has(g.id) && stadiumOf(g.stadium) !== null)
    .sort((a, b) => b.game_date.localeCompare(a.game_date))
}

/** 試合から作る訪問記録の中身。球場を引けなければ null */
export function visitFromGame(game: Game): { stadium_id: string; visited_on: string } | null {
  const stadium = stadiumOf(game.stadium)
  if (!stadium) return null
  return { stadium_id: stadium.id, visited_on: game.game_date }
}
