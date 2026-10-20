import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  addDays,
  addMonths,
  byCategory,
  daysUntil,
  fullDayText,
  intervalLabel,
  isMonthEnd,
  isMonthly,
  maxIntervalCount,
  monthlyCost,
  nextPayment,
  rejectReason,
  SHARE_REST,
  sortByNext,
  sortCategories,
  sortSubs,
  toIntervalUnit,
  toSubSort,
  topShares,
  totals,
  untilText,
  yearlyCost,
  type Billable,
} from '@/lib/subscriptions'

/**
 * サブスクの計算（0065 / 0066 / 0073）。
 *
 * 次に落ちる日の出し方が肝。契約日から周期ぶんずつ進めるので、
 * 単位ごとの数え方（週は日で足す、月と年は末日に寄せる）と、
 * 何周ぶん進めるかを固定しておく。
 */

const sub = (over: Partial<Billable> = {}): Billable => ({
  amount: 1000,
  interval_unit: 'month',
  interval_count: 1,
  anchor_on: '2026-10-10',
  ...over,
})

test('月を足す。無い日は末日に寄せる', () => {
  assert.equal(addMonths('2026-01-15', 1), '2026-02-15')
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29')
  assert.equal(addMonths('2026-01-31', 3), '2026-04-30')
  // 年をまたぐ
  assert.equal(addMonths('2026-11-20', 3), '2027-02-20')
  assert.equal(addMonths('2026-12-01', 12), '2027-12-01')
})

test('起点が末日なら、進めた先でも末日になる', () => {
  // 月末締めを「28日」「30日」として持つと、短い月のぶんだけ手前にずれる
  assert.equal(addMonths('2026-02-28', 1), '2026-03-31')
  assert.equal(addMonths('2026-04-30', 1), '2026-05-31')
  assert.equal(addMonths('2026-04-30', 2), '2026-06-30')
  assert.equal(addMonths('2026-06-30', 8), '2027-02-28')
  // 閏年の2月29日も末日
  assert.equal(addMonths('2028-02-29', 1), '2028-03-31')
  assert.equal(addMonths('2028-02-29', 12), '2029-02-28')

  // 末日でなければ、これまでどおり無い日だけ寄せる
  assert.equal(addMonths('2026-01-30', 1), '2026-02-28')
  assert.equal(addMonths('2026-01-30', 2), '2026-03-30')

  assert.equal(isMonthEnd('2026-02-28'), true)
  assert.equal(isMonthEnd('2028-02-29'), true)
  assert.equal(isMonthEnd('2026-04-30'), true)
  assert.equal(isMonthEnd('2026-04-29'), false)
  assert.equal(isMonthEnd('2026-03-30'), false)
})

test('寄せたぶんが積もらない。いつも起点から数える', () => {
  // 1/31 を起点に1か月ずつ。2月で28日に寄るが、3月は31日に戻る
  assert.equal(addMonths('2026-01-31', 2), '2026-03-31')
  assert.equal(addMonths('2026-01-31', 4), '2026-05-31')
})

test('ひと月あたりに直して比べられるようにする', () => {
  assert.equal(monthlyCost(sub({ amount: 980 })), 980)
  assert.equal(monthlyCost(sub({ amount: 11800, interval_unit: 'year' })), 983)
  // 3か月ごと
  assert.equal(monthlyCost(sub({ amount: 3000, interval_count: 3 })), 1000)
  assert.equal(yearlyCost(sub({ amount: 980 })), 11760)
  assert.equal(yearlyCost(sub({ amount: 3000, interval_count: 3 })), 12000)
  assert.equal(yearlyCost(sub({ amount: 11800, interval_unit: 'year' })), 11800)
  // 2年ごと
  assert.equal(yearlyCost(sub({ amount: 24000, interval_unit: 'year', interval_count: 2 })), 12000)
})

test('週ぎめは1年52週で月あたりに直す', () => {
  // 毎週1000円なら1年で52000円、ひと月あたりは 52000/12
  const weekly = sub({ amount: 1000, interval_unit: 'week' })
  assert.equal(yearlyCost(weekly), 52000)
  assert.equal(monthlyCost(weekly), 4333)

  // 2週間ごとはその半分
  const biweekly = sub({ amount: 1000, interval_unit: 'week', interval_count: 2 })
  assert.equal(yearlyCost(biweekly), 26000)
  assert.equal(monthlyCost(biweekly), 2167)
})

test('毎月ぴったりかどうかを見分ける', () => {
  // 月あたりを添えるかどうかに使う。毎月のものに「月1000円」は要らない
  assert.equal(isMonthly(sub()), true)
  assert.equal(isMonthly(sub({ interval_count: 3 })), false)
  assert.equal(isMonthly(sub({ interval_unit: 'week' })), false)
  assert.equal(isMonthly(sub({ interval_unit: 'year' })), false)
})

test('支払日がこれから先なら、その日そのもの', () => {
  assert.equal(nextPayment(sub({ anchor_on: '2026-10-25' }), '2026-10-13'), '2026-10-25')
  // 今日がその日なら今日
  assert.equal(nextPayment(sub({ anchor_on: '2026-10-13' }), '2026-10-13'), '2026-10-13')
})

test('過ぎていれば、周期ぶんずつ進めて最初に来る日', () => {
  // 毎月。9/25 を起点に、10/13 から見ると 10/25
  assert.equal(nextPayment(sub({ anchor_on: '2026-09-25' }), '2026-10-13'), '2026-10-25')
  // 毎月。10/5 を起点に、10/13 から見ると 11/5
  assert.equal(nextPayment(sub({ anchor_on: '2026-10-05' }), '2026-10-13'), '2026-11-05')

  // 3か月ごと。2/20 を起点にすると 2→5→8→11 月
  const quarterly = sub({ interval_count: 3, anchor_on: '2026-02-20' })
  assert.equal(nextPayment(quarterly, '2026-10-13'), '2026-11-20')
  assert.equal(nextPayment(quarterly, '2026-11-20'), '2026-11-20')
  assert.equal(nextPayment(quarterly, '2026-11-21'), '2027-02-20')

  // 半年ごと
  assert.equal(
    nextPayment(sub({ interval_count: 6, anchor_on: '2025-04-02' }), '2026-10-13'),
    '2027-04-02'
  )
  // 毎年
  assert.equal(
    nextPayment(sub({ interval_unit: 'year', anchor_on: '2024-06-03' }), '2026-10-13'),
    '2027-06-03'
  )
  // 2年ごと。2024-06-03 を起点にすると 2026→2028 年
  assert.equal(
    nextPayment(
      sub({ interval_unit: 'year', interval_count: 2, anchor_on: '2024-06-03' }),
      '2026-10-13'
    ),
    '2028-06-03'
  )
})

test('週ぎめは日で数える。月に直すとずれる', () => {
  assert.equal(addDays('2026-10-10', 7), '2026-10-17')
  // 月をまたぐ
  assert.equal(addDays('2026-10-28', 7), '2026-11-04')
  // 年をまたぐ
  assert.equal(addDays('2026-12-28', 14), '2027-01-11')
  // 閏日を越える
  assert.equal(addDays('2028-02-26', 7), '2028-03-04')

  // 毎週。10/2（金）を起点に、10/13 から見ると 10/16
  const weekly = sub({ interval_unit: 'week', anchor_on: '2026-10-02' })
  assert.equal(nextPayment(weekly, '2026-10-13'), '2026-10-16')
  assert.equal(nextPayment(weekly, '2026-10-16'), '2026-10-16')
  assert.equal(nextPayment(weekly, '2026-10-17'), '2026-10-23')
  // 曜日は変わらない。月で足していれば、ここで木曜や土曜に動いてしまう
  assert.equal(new Date('2026-10-02T00:00:00Z').getUTCDay(), 5)
  assert.equal(new Date(`${nextPayment(weekly, '2027-03-01')}T00:00:00Z`).getUTCDay(), 5)

  // 2週間ごと。10/2 を起点にすると 10/16→10/30
  const biweekly = sub({ interval_unit: 'week', interval_count: 2, anchor_on: '2026-10-02' })
  assert.equal(nextPayment(biweekly, '2026-10-13'), '2026-10-16')
  assert.equal(nextPayment(biweekly, '2026-10-17'), '2026-10-30')

  // 4週間ごとは「毎月」ではない。1年のうちに13回落ちる
  const monthish = sub({ interval_unit: 'week', interval_count: 4, anchor_on: '2026-01-02' })
  assert.equal(nextPayment(monthish, '2026-02-01'), '2026-02-27')
})

test('月末の起点でも、周期ごとに末日へ寄る', () => {
  // 1/31 を起点に毎月。2月は28日、3月は31日
  const monthly = sub({ anchor_on: '2026-01-31' })
  assert.equal(nextPayment(monthly, '2026-02-01'), '2026-02-28')
  assert.equal(nextPayment(monthly, '2026-03-01'), '2026-03-31')
  assert.equal(nextPayment(monthly, '2026-04-01'), '2026-04-30')
})

test('先の日付は年まで出す', () => {
  // 'M/D' だけだと、1年以上先の支払日が今年の話に見える
  assert.equal(fullDayText('2027-04-02'), '2027/4/2')
  assert.equal(fullDayText('2026-11-20'), '2026/11/20')
})

test('あと何日か', () => {
  assert.equal(daysUntil('2026-10-25', '2026-10-13'), 12)
  assert.equal(daysUntil('2026-10-13', '2026-10-13'), 0)
  assert.equal(daysUntil('2027-01-05', '2026-12-20'), 16)

  assert.equal(untilText(0), '今日')
  assert.equal(untilText(1), '明日')
  assert.equal(untilText(12), '12日後')
})

test('周期の見出し', () => {
  const label = (interval_unit: 'week' | 'month' | 'year', interval_count: number) =>
    intervalLabel({ interval_unit, interval_count })

  assert.equal(label('month', 1), '毎月')
  assert.equal(label('month', 2), '2か月ごと')
  assert.equal(label('month', 3), '3か月ごと')
  assert.equal(label('month', 6), '半年ごと')
  assert.equal(label('month', 12), '毎年')
  assert.equal(label('year', 1), '毎年')
  assert.equal(label('year', 2), '2年ごと')
  assert.equal(label('week', 1), '毎週')
  assert.equal(label('week', 2), '2週間ごと')
  assert.equal(label('week', 4), '4週間ごと')
})

test('単位は知らない値なら月に戻す', () => {
  // DB から来た文字をそのまま信じない
  assert.equal(toIntervalUnit('week'), 'week')
  assert.equal(toIntervalUnit('month'), 'month')
  assert.equal(toIntervalUnit('year'), 'year')
  assert.equal(toIntervalUnit('day'), 'month')
  assert.equal(toIntervalUnit(null), 'month')
  assert.equal(toIntervalUnit(undefined), 'month')
})

test('上限は単位ごとに決める', () => {
  // 月と年は5年ぶん。週は1年ぶんで止める（「104週間ごと」では長さが掴めない）
  assert.equal(maxIntervalCount('month'), 60)
  assert.equal(maxIntervalCount('year'), 5)
  assert.equal(maxIntervalCount('week'), 52)
})

test('次に落ちる順に並べる。同じ日なら高いほうが先', () => {
  const rows = [
    { ...sub({ anchor_on: '2026-10-28', amount: 500 }), name: 'C' },
    { ...sub({ anchor_on: '2026-10-20', amount: 300 }), name: 'A' },
    { ...sub({ anchor_on: '2026-10-20', amount: 900 }), name: 'B' },
  ]

  assert.deepEqual(
    sortByNext(rows, '2026-10-13').map((r) => r.name),
    ['B', 'A', 'C']
  )
})

test('並べ方を選べる', () => {
  const rows = [
    {
      ...sub({ amount: 12000, interval_unit: 'year', anchor_on: '2026-03-03' }),
      name: '年払い',
      category: '音楽',
    },
    { ...sub({ amount: 890, anchor_on: '2026-11-12' }), name: '動画A', category: '動画' },
    { ...sub({ amount: 3278, anchor_on: '2026-11-11' }), name: '回線', category: '通信' },
    { ...sub({ amount: 76500, anchor_on: '2026-11-01' }), name: '家賃', category: '生活' },
  ]
  const today = '2026-10-14'

  // 支払日が近い順
  assert.deepEqual(
    sortSubs(rows, today, 'due').map((r) => r.name),
    ['家賃', '回線', '動画A', '年払い']
  )

  // 月あたりが高い順。年払いも月額に直すので下に沈まない（12000/12=1000）
  assert.deepEqual(
    sortSubs(rows, today, 'cost').map((r) => r.name),
    ['家賃', '回線', '年払い', '動画A']
  )

  // ジャンルの決まった並びでまとめ、中は金額順
  assert.deepEqual(
    sortSubs(rows, today, 'category').map((r) => r.category),
    ['動画', '音楽', '生活', '通信']
  )

  // 元の配列は変えない
  assert.equal(rows[0].name, '年払い')
})

test('覚えておいた並べ方を読み直す', () => {
  assert.equal(toSubSort('cost'), 'cost')
  assert.equal(toSubSort('category'), 'category')
  // 知らない値や空なら既定に戻す
  assert.equal(toSubSort('なんとか'), 'due')
  assert.equal(toSubSort(null), 'due')
})

test('合計は使っているものだけ数える', () => {
  const rows = [
    { ...sub({ amount: 980 }), active: true },
    { ...sub({ amount: 3000, interval_count: 3 }), active: true },
    { ...sub({ amount: 5000 }), active: false },
  ]

  const sum = totals(rows)
  assert.equal(sum.count, 2)
  assert.equal(sum.monthly, 980 + 1000)
  assert.equal(sum.yearly, 11760 + 12000)
})

test('ジャンルごとに多い順でまとめる', () => {
  const rows = [
    { ...sub({ amount: 500 }), active: true, category: '音楽' },
    { ...sub({ amount: 1200 }), active: true, category: '動画' },
    { ...sub({ amount: 2400, interval_count: 3 }), active: true, category: '動画' },
    { ...sub({ amount: 9000 }), active: false, category: '仕事' },
  ]

  assert.deepEqual(byCategory(rows), [
    { category: '動画', monthly: 2000 },
    { category: '音楽', monthly: 500 },
  ])
})

test('ジャンルは決まった順に並べ、その他を最後に置く', () => {
  // 使った順で出すと、開くたびに位置が変わって目で探し直すことになる
  assert.deepEqual(sortCategories(['その他', '通信', '動画', '仕事']), [
    '動画',
    '仕事',
    '通信',
    'その他',
  ])

  // 自分で書いたものは決まったものの後ろ、「その他」の前。五十音順
  assert.deepEqual(sortCategories(['その他', 'ジム', '動画', 'サウナ']), [
    '動画',
    'サウナ',
    'ジム',
    'その他',
  ])

  // 重複は外す
  assert.deepEqual(sortCategories(['動画', '動画', 'その他', 'その他']), ['動画', 'その他'])

  // 「その他」が無ければ付け足さない
  assert.deepEqual(sortCategories(['音楽', '動画']), ['動画', '音楽'])
  assert.deepEqual(sortCategories([]), [])
})

test('内訳は上から数件にまとめ、割合を付ける', () => {
  const items = [
    { category: '生活', monthly: 7700 },
    { category: '通信', monthly: 1000 },
    { category: '動画', monthly: 800 },
    { category: 'ゲーム', monthly: 300 },
    { category: '読書', monthly: 150 },
    { category: '音楽', monthly: 30 },
    { category: '仕事', monthly: 20 },
  ]

  const shares = topShares(items, 5)
  // 6件目から先は「ほか」にまとめる
  assert.deepEqual(
    shares.map((s) => s.category),
    ['生活', '通信', '動画', 'ゲーム', '読書', SHARE_REST]
  )
  assert.equal(shares.at(-1)?.monthly, 50)
  assert.equal(shares[0].percent, 77)

  // 出ているのに0%とは書かない。無いのかと思う
  assert.equal(shares.at(-1)?.percent, 1)

  // まとめる必要が無ければ「ほか」を足さない
  assert.deepEqual(
    topShares(items.slice(0, 3), 5).map((s) => s.category),
    ['生活', '通信', '動画']
  )
  assert.deepEqual(topShares([], 5), [])
})

test('内訳に0円のジャンルを出さない', () => {
  const rows = [
    { ...sub({ amount: 1000 }), active: true, category: '動画' },
    { ...sub({ amount: 0 }), active: true, category: 'その他' },
  ]
  assert.deepEqual(byCategory(rows), [{ category: '動画', monthly: 1000 }])
})

test('入力を確かめる', () => {
  const ok = {
    name: 'Netflix',
    amount: '1590',
    interval_unit: 'month',
    interval_count: '1',
    anchor_on: '2026-10-25',
    url: 'https://example.com',
  }
  assert.equal(rejectReason(ok), null)

  assert.match(String(rejectReason({ ...ok, name: '  ' })), /サービス名/)
  assert.match(String(rejectReason({ ...ok, amount: 'ただ' })), /金額/)
  assert.match(String(rejectReason({ ...ok, amount: '-1' })), /金額/)
  assert.match(String(rejectReason({ ...ok, interval_count: '0' })), /周期/)
  assert.match(String(rejectReason({ ...ok, interval_count: '61' })), /周期/)
  assert.equal(rejectReason({ ...ok, interval_count: '60' }), null)
  assert.match(String(rejectReason({ ...ok, interval_count: '1.5' })), /周期/)

  // 上限は単位ごとに違う。年で6は止め、週で52は通す
  assert.match(String(rejectReason({ ...ok, interval_unit: 'year', interval_count: '6' })), /周期/)
  assert.equal(rejectReason({ ...ok, interval_unit: 'year', interval_count: '5' }), null)
  assert.equal(rejectReason({ ...ok, interval_unit: 'week', interval_count: '52' }), null)
  assert.match(String(rejectReason({ ...ok, interval_unit: 'week', interval_count: '53' })), /周期/)
  // 知らない単位は保存させない
  assert.match(String(rejectReason({ ...ok, interval_unit: 'day' })), /単位/)

  // カレンダーから選ばずに保存しようとした
  assert.match(String(rejectReason({ ...ok, anchor_on: '' })), /契約日/)
  // 押した人の画面で動くものをリンクにしない
  assert.match(String(rejectReason({ ...ok, url: 'javascript:alert(1)' })), /解約ページ/)

  // 3か月ごとも通る
  assert.equal(rejectReason({ ...ok, interval_count: '3' }), null)
})
