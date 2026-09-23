import type { SeasonGame } from '@/types'
import { leagueOf } from './standings'

/**
 * 雨天中止のあと、振替日がまだ決まっていない試合の数え方。
 *
 * DB も時計も触らない純関数にしてある。
 *
 * npb.jp の日程ページは、振替日が決まるまで振替試合を載せない。中止の行は
 * もとの日に残るだけなので、日程だけを見ると「中止が増えて試合が減った」
 * ように見える。何試合が宙に浮いているのかは、対戦ごとの試合数を数えれば
 * 分かる。同じリーグの相手とは同じ試合数を戦うので、ほかの相手と比べて
 * 少ない相手がいれば、その差が日程未定のぶんになる。
 *
 * 「1シーズン143試合」のような決め打ちはしない。試合数は年によって変わる
 * （2020年は120試合だった）。日程表から読めるもので数える。
 */

export type PendingSeries = {
  opponent: string
  /** まだ日付が決まっていない試合数 */
  games: number
}

/**
 * いちばん多く現れた値。並ぶときは大きいほうを採る。
 *
 * 相手が5人いれば、4人は同じ試合数になる。1つだけ多い相手がいても
 * （日程表の重複など）引きずられないよう、最大ではなく最頻値を使う。
 */
function modeMax(counts: number[]): number {
  const times = new Map<number, number>()
  for (const count of counts) times.set(count, (times.get(count) ?? 0) + 1)

  let best = 0
  let bestTimes = 0
  for (const [count, n] of times) {
    if (n > bestTimes || (n === bestTimes && count > best)) {
      best = count
      bestTimes = n
    }
  }
  return best
}

/** 相手ごとの、中止を除いた試合数（日付の決まっている試合） */
function plannedByOpponent(games: SeasonGame[], team: string): Map<string, number> {
  const planned = new Map<string, number>()
  for (const game of games) {
    if (game.home_team !== team && game.away_team !== team) continue
    const opponent = game.home_team === team ? game.away_team : game.home_team
    if (!leagueOf(opponent)) continue
    const now = planned.get(opponent) ?? 0
    planned.set(opponent, game.status === 'cancelled' ? now : now + 1)
  }
  return planned
}

/**
 * 振替日が決まっていない試合を、相手ごとに数える。
 *
 * 同じリーグの相手と、交流戦の相手は試合数が違うので、分けて比べる。
 * 日程がまだ入りきっていない時期（シーズン前や、先の月を取り込む前）は
 * どの相手も同じように少ないので、差が出ず0件になる。多く出しすぎない。
 */
export function pendingSeries(games: SeasonGame[], team: string): PendingSeries[] {
  const league = leagueOf(team)
  if (!league) return []

  const planned = plannedByOpponent(games, team)
  const groups: Record<'same' | 'inter', string[]> = { same: [], inter: [] }
  for (const opponent of planned.keys()) {
    groups[leagueOf(opponent) === league ? 'same' : 'inter'].push(opponent)
  }

  const rows: PendingSeries[] = []
  for (const opponents of Object.values(groups)) {
    if (opponents.length < 2) continue
    const full = modeMax(opponents.map((opponent) => planned.get(opponent) ?? 0))
    for (const opponent of opponents) {
      const games = full - (planned.get(opponent) ?? 0)
      if (games > 0) rows.push({ opponent, games })
    }
  }

  return rows.sort((a, b) => b.games - a.games || a.opponent.localeCompare(b.opponent, 'ja'))
}
