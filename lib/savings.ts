import type { BreakdownLine, Game, Phase, SavingRules } from '@/types'

/**
 * 貯金ルールの初期値。
 * 仕様書 7.2 と確定UIのボーナス項目をベースに、旧 baseball-savings アプリの
 * 満塁HR・完投・ノーヒットノーラン・完全試合も引き継ぐ。
 */
export const DEFAULT_SAVING_RULES: SavingRules = {
  win_amount: 500,
  draw_amount: 200,
  lose_amount: 0,
  sayonara_bonus: 500,
  home_run_amount: 200,
  grand_slam_amount: 500,
  multi_hit_amount: 100,
  rbi_amount: 100,
  perfect_game_amount: 5000,
  no_hitter_amount: 3000,
  shutout_amount: 500,
  complete_game_amount: 100,
  quality_start_amount: 200,
  winning_pitcher_amount: 0,
  hold_amount: 100,
  save_amount: 100,
  multiplier_regular: 1.0,
  multiplier_interleague: 1.0,
  multiplier_cs: 1.2,
  multiplier_nippon_series: 1.5,
}

/** 貯金額計算の入力に必要な試合情報だけを抜き出した型 */
export type ScorableGame = Pick<
  Game,
  | 'phase'
  | 'result'
  | 'is_sayonara'
  | 'home_runs'
  | 'grand_slams'
  | 'multi_hits'
  | 'rbi'
  | 'pitching_highlight'
  | 'holds'
  | 'has_save'
>

export type SavingCalculation = {
  lines: BreakdownLine[]
  /** 倍率をかける前の小計 */
  subtotal: number
  phase: Phase
  multiplier: number
  /** 最終的な積立予定額（円） */
  amount: number
}

export function phaseMultiplier(rules: SavingRules, phase: Phase): number {
  switch (phase) {
    case 'interleague':
      return Number(rules.multiplier_interleague)
    case 'cs':
      return Number(rules.multiplier_cs)
    case 'nippon_series':
      return Number(rules.multiplier_nippon_series)
    case 'regular':
    default:
      return Number(rules.multiplier_regular)
  }
}

function highlightAmount(rules: SavingRules, game: ScorableGame): BreakdownLine | null {
  switch (game.pitching_highlight) {
    case 'perfect_game':
      return { key: 'perfect_game', label: '完全試合', amount: rules.perfect_game_amount }
    case 'no_hitter':
      return { key: 'no_hitter', label: 'ノーヒットノーラン', amount: rules.no_hitter_amount }
    case 'shutout':
      return { key: 'shutout', label: '完封', amount: rules.shutout_amount }
    case 'complete_game':
      return { key: 'complete_game', label: '完投', amount: rules.complete_game_amount }
    case 'quality_start':
      return { key: 'quality_start', label: 'QS', amount: rules.quality_start_amount }
    default:
      return null
  }
}

/**
 * 共通の試合データ + 個人の貯金ルール → 積立予定額。
 *
 * - 先発ハイライトは最上位のみを加算する（完封と完投は重複させない）
 * - 勝利投手・セーブは先発ハイライトとは独立して加算する
 * - その他ボーナス（otherAmount）も倍率の対象に含める（旧アプリの挙動を踏襲）
 */
export function calcSaving(
  game: ScorableGame,
  rules: SavingRules,
  otherAmount = 0
): SavingCalculation {
  const lines: BreakdownLine[] = []

  if (game.result === 'win') {
    lines.push({ key: 'win', label: '勝利', amount: rules.win_amount })
    if (game.is_sayonara && rules.sayonara_bonus > 0) {
      lines.push({ key: 'sayonara', label: 'サヨナラ勝利', amount: rules.sayonara_bonus })
    }
  } else if (game.result === 'draw') {
    lines.push({ key: 'draw', label: '引き分け', amount: rules.draw_amount })
  } else if (rules.lose_amount > 0) {
    lines.push({ key: 'lose', label: '敗北', amount: rules.lose_amount })
  }

  if (game.home_runs > 0 && rules.home_run_amount > 0) {
    lines.push({
      key: 'home_run',
      label: `ホームラン ${game.home_runs}本`,
      amount: game.home_runs * rules.home_run_amount,
    })
  }
  if (game.grand_slams > 0 && rules.grand_slam_amount > 0) {
    lines.push({
      key: 'grand_slam',
      label: `満塁ホームラン ${game.grand_slams}本`,
      amount: game.grand_slams * rules.grand_slam_amount,
    })
  }
  if (game.multi_hits > 0 && rules.multi_hit_amount > 0) {
    lines.push({
      key: 'multi_hit',
      label: `マルチ安打 ${game.multi_hits}人`,
      amount: game.multi_hits * rules.multi_hit_amount,
    })
  }
  if (game.rbi > 0 && rules.rbi_amount > 0) {
    lines.push({
      key: 'rbi',
      label: `打点 ${game.rbi}`,
      amount: game.rbi * rules.rbi_amount,
    })
  }

  const highlight = highlightAmount(rules, game)
  if (highlight && highlight.amount > 0) lines.push(highlight)

  // 勝利投手ではなくホールドを数える（0061）。先発が勝つ日は限られるが、
  // 中継ぎがリードを守った日は多い。そちらを拾ったほうが積立が動く。
  // 1試合に2人以上付くことがあるので、人数ぶん足す（0062）
  if (game.holds > 0 && rules.hold_amount > 0) {
    lines.push({
      key: 'hold',
      label: `ホールド ${game.holds}人`,
      amount: game.holds * rules.hold_amount,
    })
  }
  if (game.has_save && rules.save_amount > 0) {
    lines.push({ key: 'save', label: 'セーブ', amount: rules.save_amount })
  }

  if (otherAmount > 0) {
    lines.push({ key: 'other', label: 'その他ボーナス', amount: otherAmount })
  }

  const subtotal = lines.reduce((sum, line) => sum + line.amount, 0)
  const multiplier = phaseMultiplier(rules, game.phase)

  return {
    lines,
    subtotal,
    phase: game.phase,
    multiplier,
    amount: Math.round(subtotal * multiplier),
  }
}

const RESULT_KEYS = ['win', 'draw', 'lose', 'sayonara']
const BATTING_KEYS = ['home_run', 'grand_slam', 'multi_hit', 'rbi']

/** 内訳をカテゴリ単位（勝敗/打撃/投手/その他）にまとめる。月次サマリー用。 */
export function groupBreakdown(lines: BreakdownLine[]): Record<string, number> {
  const groups: Record<string, number> = {
    result: 0,
    batting: 0,
    pitching: 0,
    other: 0,
  }
  for (const line of lines) {
    if (RESULT_KEYS.includes(line.key)) groups.result += line.amount
    else if (BATTING_KEYS.includes(line.key)) groups.batting += line.amount
    else if (line.key === 'other' || line.key === 'custom') groups.other += line.amount
    else groups.pitching += line.amount
  }
  return groups
}

export const BREAKDOWN_GROUP_LABEL: Record<string, string> = {
  result: '勝敗ボーナス',
  batting: '打撃ボーナス',
  pitching: '投手ボーナス',
  other: 'その他',
}
