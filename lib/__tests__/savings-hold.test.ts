import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_SAVING_RULES, calcSaving, type ScorableGame } from '@/lib/savings'

/**
 * 投手ボーナスの「勝利投手」を「ホールド」に置き換えた（0061）。
 * ホールドは1試合に2人以上付くので、人数ぶん足す（0062）。
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
  holds: 0,
  has_save: false,
  ...over,
})

const rules = { ...DEFAULT_SAVING_RULES, win_amount: 500, hold_amount: 100, save_amount: 100 }

test('ホールドは人数ぶん足す', () => {
  const one = calcSaving(game({ holds: 1 }), rules)
  assert.deepEqual(
    one.lines.map((l) => [l.key, l.label, l.amount]),
    [
      ['win', '勝利', 500],
      ['hold', 'ホールド 1人', 100],
    ]
  )
  assert.equal(one.amount, 600)

  // 10/2 の実データ。鈴木と中森の2人に付いた
  const two = calcSaving(game({ holds: 2 }), rules)
  assert.equal(two.lines.find((l) => l.key === 'hold')?.label, 'ホールド 2人')
  assert.equal(two.amount, 700)

  // 継投がつながった日
  assert.equal(calcSaving(game({ holds: 3 }), rules).amount, 800)
})

test('ホールドとセーブは別に数える', () => {
  const calc = calcSaving(game({ holds: 2, has_save: true }), rules)

  assert.deepEqual(
    calc.lines.map((l) => l.key),
    ['win', 'hold', 'save']
  )
  // 500 + 100*2 + 100
  assert.equal(calc.amount, 800)
})

test('ホールドが付かなければ足さない', () => {
  assert.equal(calcSaving(game(), rules).amount, 500)
  // 金額が 0 のときも行を出さない
  assert.equal(calcSaving(game({ holds: 2 }), { ...rules, hold_amount: 0 }).amount, 500)
})

test('負けた試合でもホールドは数える', () => {
  // 中継ぎがリードを守ったあとで逆転されることはある（10/2 がその形）
  const calc = calcSaving(game({ result: 'lose', holds: 2 }), { ...rules, lose_amount: 0 })

  assert.deepEqual(
    calc.lines.map((l) => l.key),
    ['hold']
  )
  assert.equal(calc.amount, 200)
})

test('勝利投手はもう数えない', () => {
  const calc = calcSaving(game({ holds: 1, has_save: true }), rules)

  assert.equal(
    calc.lines.some((l) => l.key === 'winning_pitcher'),
    false
  )
})

test('フェーズ倍率はホールドにもかかる', () => {
  const calc = calcSaving(game({ phase: 'nippon_series', holds: 2 }), {
    ...rules,
    multiplier_nippon_series: 1.5,
  })

  // (500 + 200) * 1.5
  assert.equal(calc.amount, 1050)
})
