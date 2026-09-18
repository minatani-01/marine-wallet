import { HOME_STADIUMS, REGIONAL_STADIUMS, stadiumOf, type Stadium } from '@/lib/stadiums'
import type { Game, StadiumVisit } from '@/types'

/**
 * 球場スタンプの集計。
 *
 * DB も時計も触らない純関数にしてある。「行った球場」は金額ではないが、
 * 数え方を間違えると「行っていない球場にスタンプが付く」という、
 * 気付きにくい嘘になる。試合データと訪問記録を分けて扱い、
 * スタンプの根拠を訪問記録だけに置く。
 *
 * スタンプは球場ごとに1枚（本拠地なら12枚）だが、日付と点数は試合ごとにある。
 * 券面には初めて行った試合の日付と点数を刻み、同じ球場の2回目以降は
 * 履歴として券の下にぶら下げる。スタンプ帳は「いつ初めてそこへ行ったか」の
 * 記録であって、観戦記録の一覧ではないため。
 */

/** 券面と履歴に出す1回ぶんの来場 */
export type StampVisit = {
  visitId: string
  date: string
  /** 観戦した試合のID。試合の無い日の来場なら null */
  gameId: string | null
  /** 観戦した試合。IDがあっても手元に試合を渡していなければ null */
  game: Game | null
  /** 券面に刻む点数（'5-1'）。点数の無い試合は null */
  score: string | null
}

export type StadiumStamp = {
  stadium: Stadium
  /** 券面の通し番号。本拠地は 1..12 */
  no: number
  visited: boolean
  /** 初めて行った日。行っていなければ null */
  firstVisit: string | null
  /** 行った回数 */
  visits: number
  /** そのうち試合を観た回数 */
  games: number
  /** 行った順（古い順）。先頭が券面になる */
  log: StampVisit[]
}

export type StampCard = {
  home: StadiumStamp[]
  regional: StadiumStamp[]
  /** 12球団の本拠地のうち行った数 */
  homeVisited: number
  /** 地方球場のうち行った数 */
  regionalVisited: number
}

/** 試合の点数。片方でも欠けていれば null（0-0 と区別する） */
export function scoreOf(game: Game | null): string | null {
  if (!game) return null
  if (game.marines_score == null || game.opponent_score == null) return null
  return `${game.marines_score}-${game.opponent_score}`
}

function stampFor(stadium: Stadium, no: number, visits: StadiumVisit[], byGame: Map<string, Game>): StadiumStamp {
  const log: StampVisit[] = visits
    .filter((v) => v.stadium_id === stadium.id)
    .sort((a, b) => a.visited_on.localeCompare(b.visited_on))
    .map((v) => {
      const game = (v.game_id ? byGame.get(v.game_id) : null) ?? null
      return { visitId: v.id, date: v.visited_on, gameId: v.game_id, game, score: scoreOf(game) }
    })

  return {
    stadium,
    no,
    visited: log.length > 0,
    firstVisit: log[0]?.date ?? null,
    visits: log.length,
    games: log.filter((v) => v.gameId !== null).length,
    log,
  }
}

/**
 * スタンプ帳を組み立てる。
 *
 * games は券面に点数を刻むために使うだけで、スタンプの有無には効かない。
 * 渡さなくても日付だけのスタンプになる。
 */
export function buildStampCard(visits: StadiumVisit[], games: Game[] = []): StampCard {
  const byGame = new Map(games.map((g) => [g.id, g]))
  const home = HOME_STADIUMS.map((s, i) => stampFor(s, i + 1, visits, byGame))
  const regional = REGIONAL_STADIUMS.map((s, i) => stampFor(s, i + 1, visits, byGame))

  return {
    home,
    regional,
    homeVisited: home.filter((s) => s.visited).length,
    regionalVisited: regional.filter((s) => s.visited).length,
  }
}

/** その試合の来場記録。押していなければ null */
export function visitOfGame(gameId: string, visits: StadiumVisit[]): StadiumVisit | null {
  return visits.find((v) => v.game_id === gameId) ?? null
}

/** 試合から作る訪問記録の中身。球場を引けなければ null */
export function visitFromGame(game: Game): { stadium_id: string; visited_on: string } | null {
  const stadium = stadiumOf(game.stadium)
  if (!stadium) return null
  return { stadium_id: stadium.id, visited_on: game.game_date }
}
