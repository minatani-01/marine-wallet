import { OPPONENTS } from '@/lib/constants'
import type { GameResult, HomeAway, Phase } from '@/types'

/**
 * npb.jp から取った試合を、貯金が見る `games` の形に直す。
 *
 * 取り込みは「前日に終わった1試合」だけを対象にする。過去分をまとめて
 * 作り直すと、想定しない書き換えが起きたときに追えなくなるため。
 *
 * ここは純関数にしてある。DB も時計も触らないので、実データを貼って
 * テストで確かめられる。判断に迷うものは作らず理由を返し、
 * 呼び出し側が記録して人が手で入れられるようにする。
 *
 * 自動では埋めない項目（いずれも npb.jp の公開範囲では確かめられない）:
 *   サヨナラ勝ち … イニング別得点を取っていないので判定できない
 *   投手の記録   … 完封・完投は投球回が要る。ボックススコアから取っていない
 *   勝利投手     … マリーンズが勝てば必ず自軍から出るので、そのまま入れると
 *                   全勝利に上乗せが付く。手入力の53勝では1度も使っていない
 *   マルチ安打・打点 … 個人別の打撃成績を NPB 公式が公開していない
 */

/** 日程表での自軍の表記 */
export const MARINES_LABEL = 'ロッテ'

export type NpbHomeRun = {
  team: string
  batter: string
  /** 「山口 29号（6回2ラン 田中）」のような原文 */
  detail: string
}

/** 取り込み元。npb_games の行のうち、判断に使う分だけ */
export type NpbGameSource = {
  game_date: string
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  place: string
  phase: string
  status: string
  save_pitcher: string
  raw: unknown
}

/** `games` に入れる形。金額はここでは決めない */
export type ImportedGame = {
  game_date: string
  opponent: string
  phase: Phase
  home_away: HomeAway
  stadium: string
  result: GameResult
  is_sayonara: boolean
  marines_score: number
  opponent_score: number
  home_runs: number
  grand_slams: number
  multi_hits: number
  rbi: number
  pitching_highlight: 'none'
  is_winning_pitcher: boolean
  has_save: boolean
  other_amount: number
  other_note: string
  source: 'npb'
}

export type ImportResult =
  | { ok: true; game: ImportedGame }
  /** 作らなかった理由。実行ログに残して、人が手で入れる目印にする */
  | { ok: false; reason: string }

const PHASES: Phase[] = ['regular', 'interleague', 'cs', 'nippon_series']

function toPhase(value: string): Phase {
  return (PHASES as string[]).includes(value) ? (value as Phase) : 'regular'
}

/** 日程表の球団名から、アプリの対戦相手IDへ。知らない名前は変換しない */
export function opponentIdFromLabel(label: string): string | null {
  const trimmed = label.trim()
  return OPPONENTS.find((o) => o.label === trimmed)?.id ?? null
}

/** ボックススコアの本塁打欄から、自軍の本塁打だけを数える */
export function countMarinesHomeRuns(homeRuns: NpbHomeRun[]): {
  home_runs: number
  grand_slams: number
} {
  const ours = homeRuns.filter((hr) => hr.team.trim() === MARINES_LABEL)
  // 満塁本塁打は別枠。games.home_runs は満塁を含まない数で持つ
  const slams = ours.filter((hr) => hr.detail.includes('満塁')).length
  return { home_runs: ours.length - slams, grand_slams: slams }
}

/** raw から本塁打欄を取り出す。無ければ null（取り込みを見送る） */
function homeRunsOf(raw: unknown): NpbHomeRun[] | null {
  if (!raw || typeof raw !== 'object') return null
  const box = (raw as { box?: unknown }).box
  if (!box || typeof box !== 'object') return null
  const list = (box as { homeRuns?: unknown }).homeRuns
  if (!Array.isArray(list)) return null

  return list.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const { team, batter, detail } = item as Record<string, unknown>
    if (typeof team !== 'string' || typeof detail !== 'string') return []
    return [{ team, batter: typeof batter === 'string' ? batter : '', detail }]
  })
}

export function gameFromNpb(row: NpbGameSource): ImportResult {
  if (row.status !== 'finished') {
    return { ok: false, reason: `まだ終わっていません（${row.status}）` }
  }

  const isHome = row.home_team.trim() === MARINES_LABEL
  const isAway = row.away_team.trim() === MARINES_LABEL
  if (!isHome && !isAway) {
    return { ok: false, reason: 'マリーンズの試合ではありません' }
  }

  const marinesScore = isHome ? row.home_score : row.away_score
  const opponentScore = isHome ? row.away_score : row.home_score
  if (marinesScore === null || opponentScore === null) {
    return { ok: false, reason: '得点が入っていません（中止や延期の可能性）' }
  }

  const opponentLabel = isHome ? row.away_team : row.home_team
  const opponent = opponentIdFromLabel(opponentLabel)
  if (!opponent) {
    return { ok: false, reason: `対戦相手を判別できません（${opponentLabel}）` }
  }

  // 本塁打の数はボックススコアからしか取れない。
  // 取れていないのに0本として作ると、静かに少ない金額で確定してしまう
  const homeRuns = homeRunsOf(row.raw)
  if (homeRuns === null) {
    return { ok: false, reason: 'ボックススコアを取得できていません' }
  }

  const result: GameResult =
    marinesScore > opponentScore ? 'win' : marinesScore < opponentScore ? 'lose' : 'draw'

  return {
    ok: true,
    game: {
      game_date: row.game_date,
      opponent,
      phase: toPhase(row.phase),
      home_away: (isHome ? 'home' : 'away') satisfies HomeAway,
      stadium: row.place.trim(),
      result,
      is_sayonara: false,
      marines_score: marinesScore,
      opponent_score: opponentScore,
      ...countMarinesHomeRuns(homeRuns),
      multi_hits: 0,
      rbi: 0,
      pitching_highlight: 'none',
      is_winning_pitcher: false,
      // セーブが付くのは勝った試合だけ。負け試合に相手のセーブを拾わない
      has_save: result === 'win' && row.save_pitcher.trim().length > 0,
      other_amount: 0,
      other_note: '',
      source: 'npb',
    },
  }
}
