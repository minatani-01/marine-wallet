import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  byCategory,
  daysUntil,
  monthlyCost,
  nextPayment,
  rejectReason,
  sortByNext,
  totals,
  untilText,
  yearlyCost,
  type Billable,
} from '@/lib/subscriptions'

/**
 * サブスクの計算（0065）。
 *
 * 次に落ちる日の出し方が肝。月末の指定と、年をまたぐところを固定しておく。
 */

const sub = (over: Partial<Billable> = {}): Billable => ({
  amount: 1000,
  cycle: 'monthly',
  billing_day: 10,
  billing_month: null,
  ...over,
})

test('ひと月あたりに直して比べられるようにする', () => {
  assert.equal(monthlyCost(sub({ amount: 980 })), 980)
  // 年払いは12で割る。円に小数は無いので丸める
  assert.equal(monthlyCost(sub({ amount: 11800, cycle: 'yearly' })), 983)
  assert.equal(yearlyCost(sub({ amount: 980 })), 11760)
  assert.equal(yearlyCost(sub({ amount: 11800, cycle: 'yearly' })), 11800)
})

test('毎月：まだ来ていなければ今月、過ぎていれば翌月', () => {
  assert.equal(nextPayment(sub({ billing_day: 25 }), '2026-10-13'), '2026-10-25')
  assert.equal(nextPayment(sub({ billing_day: 5 }), '2026-10-13'), '2026-11-05')
  // 今日がその日なら今日
  assert.equal(nextPayment(sub({ billing_day: 13 }), '2026-10-13'), '2026-10-13')
})

test('毎月：無い日は末日に寄せる', () => {
  // 2月に31日は無い。翌月1日に繰り上げない
  assert.equal(nextPayment(sub({ billing_day: 31 }), '2026-02-01'), '2026-02-28')
  // うるう年
  assert.equal(nextPayment(sub({ billing_day: 31 }), '2028-02-01'), '2028-02-29')
  // 30日までの月
  assert.equal(nextPayment(sub({ billing_day: 31 }), '2026-04-02'), '2026-04-30')
})

test('毎月：12月を過ぎたら翌年の1月', () => {
  assert.equal(nextPayment(sub({ billing_day: 5 }), '2026-12-20'), '2027-01-05')
})

test('毎年：月と日で決め、過ぎていれば翌年', () => {
  const yearly = sub({ cycle: 'yearly', billing_month: 3, billing_day: 20 })
  assert.equal(nextPayment(yearly, '2026-01-10'), '2026-03-20')
  assert.equal(nextPayment(yearly, '2026-03-20'), '2026-03-20')
  assert.equal(nextPayment(yearly, '2026-03-21'), '2027-03-20')

  // 2月29日の指定。うるう年でない年は28日へ寄せる
  const leap = sub({ cycle: 'yearly', billing_month: 2, billing_day: 29 })
  assert.equal(nextPayment(leap, '2026-01-01'), '2026-02-28')
  assert.equal(nextPayment(leap, '2028-01-01'), '2028-02-29')
})

test('あと何日か', () => {
  assert.equal(daysUntil('2026-10-25', '2026-10-13'), 12)
  assert.equal(daysUntil('2026-11-05', '2026-10-13'), 23)
  assert.equal(daysUntil('2026-10-13', '2026-10-13'), 0)
  // 年をまたいでも合う
  assert.equal(daysUntil('2027-01-05', '2026-12-20'), 16)

  assert.equal(untilText(0), '今日')
  assert.equal(untilText(1), '明日')
  assert.equal(untilText(12), '12日後')
})

test('次に落ちる順に並べる。同じ日なら高いほうが先', () => {
  const rows = [
    { ...sub({ billing_day: 28, amount: 500 }), name: 'C' },
    { ...sub({ billing_day: 20, amount: 300 }), name: 'A' },
    { ...sub({ billing_day: 20, amount: 900 }), name: 'B' },
  ]

  assert.deepEqual(
    sortByNext(rows, '2026-10-13').map((r) => r.name),
    ['B', 'A', 'C']
  )
})

test('合計は使っているものだけ数える', () => {
  const rows = [
    { ...sub({ amount: 980 }), active: true },
    { ...sub({ amount: 11800, cycle: 'yearly' }), active: true },
    // 止めたものは数えない。記録としては残す
    { ...sub({ amount: 5000 }), active: false },
  ]

  const sum = totals(rows)
  assert.equal(sum.count, 2)
  assert.equal(sum.monthly, 980 + 983)
  assert.equal(sum.yearly, 11760 + 11800)
})

test('ジャンルごとに多い順でまとめる', () => {
  const rows = [
    { ...sub({ amount: 500 }), active: true, category: '音楽' },
    { ...sub({ amount: 1200 }), active: true, category: '動画' },
    { ...sub({ amount: 800 }), active: true, category: '動画' },
    { ...sub({ amount: 9000 }), active: false, category: '仕事' },
  ]

  assert.deepEqual(byCategory(rows), [
    { category: '動画', monthly: 2000 },
    { category: '音楽', monthly: 500 },
  ])
})

test('入力を確かめる', () => {
  const ok = {
    name: 'Netflix',
    amount: '1590',
    billing_day: '25',
    cycle: 'monthly',
    billing_month: '',
    url: 'https://example.com',
  }
  assert.equal(rejectReason(ok), null)

  assert.match(String(rejectReason({ ...ok, name: '  ' })), /サービス名/)
  assert.match(String(rejectReason({ ...ok, amount: 'ただ' })), /金額/)
  assert.match(String(rejectReason({ ...ok, amount: '-1' })), /金額/)
  assert.match(String(rejectReason({ ...ok, billing_day: '0' })), /支払日/)
  assert.match(String(rejectReason({ ...ok, billing_day: '32' })), /支払日/)
  // 押した人の画面で動くものをリンクにしない
  assert.match(String(rejectReason({ ...ok, url: 'javascript:alert(1)' })), /解約ページ/)

  // 毎年は月も要る
  assert.match(
    String(rejectReason({ ...ok, cycle: 'yearly', billing_month: '' })),
    /支払月/
  )
  assert.equal(rejectReason({ ...ok, cycle: 'yearly', billing_month: '3' }), null)
})
