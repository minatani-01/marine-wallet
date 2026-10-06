import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_SAVING_RULES, calcSaving, type ScorableGame } from '@/lib/savings'

/**
 * 投手ボーナスの「勝利投手」を「ホールド」に置き換えた（0061）。
 *
 * ここは金額を決めるところなので、置き換えが効いていることと、
 * 他の加算に影響していないことを確かめておく。
 */

const game = (over: Partial<ScorableGame> = {}): ScorableGame => ({
  phase: 'regular',
  result: 'win',
  is_sayonara: false,
  home_runs: 0,
  grand_slams: 0,
  multi_hits: 0,
  rbi: 0,
  pitching_highlight: 'none',
  has_hold: false,
  has_save: false,
  ...over,
})

const rules = { ...DEFAULT_SAVING_RULES, win_amount: 500, hold_amount: 100, save_amount: 100 }

test('ホールドが付いた試合は加算する', () => {
  const calc = calcSaving(game({ has_hold: true }), rules)

  assert.deepEqual(
    calc.lines.map((l) => [l.key, l.label, l.amount]),
    [
      ['win', '勝利', 500],
      ['hold', 'ホールド', 100],
    ]
  )
  assert.equal(calc.amount, 600)
})

test('ホールドとセーブは別に数える', () => {
  const calc = calcSaving(game({ has_hold: true, has_save: true }), rules)

  assert.deepEqual(
    calc.lines.map((l) => l.key),
    ['win', 'hold', 'save']
  )
  assert.equal(calc.amount, 700)
})

test('ホールドが付かなければ足さない', () => {
  assert.equal(calcSaving(game(), rules).amount, 500)
  // 金額が 0 のときも行を出さない
  assert.equal(calcSaving(game({ has_hold: true }), { ...rules, hold_amount: 0 }).amount, 500)
})

test('負けた試合でもホールドは数える', () => {
  // 中継ぎがリードを守ったあとで逆転されることはある
  const calc = calcSaving(game({ result: 'lose', has_hold: true }), { ...rules, lose_amount: 0 })

  assert.deepEqual(
    calc.lines.map((l) => l.key),
    ['hold']
  )
  assert.equal(calc.amount, 100)
})

test('勝利投手はもう数えない', () => {
  const calc = calcSaving(game({ has_hold: true, has_save: true }), rules)

  assert.equal(
    calc.lines.some((l) => l.key === 'winning_pitcher'),
    false
  )
})

test('フェーズ倍率はホールドにもかかる', () => {
  const calc = calcSaving(game({ phase: 'nippon_series', has_hold: true }), {
    ...rules,
    multiplier_nippon_series: 1.5,
  })

  // (500 + 100) * 1.5
  assert.equal(calc.amount, 900)
})
