import { test } from 'node:test'
import assert from 'node:assert/strict'

import { moveItem, reorderedSortOrders, type Sortable } from '@/lib/sortable'

/**
 * 手で並べ替えたときの番号の振り直し（0063）。
 *
 * ジャンルで絞っているあいだに並べ替えても、見えていない品を巻き込まない。
 * ここを間違えると、別のジャンルの並びが勝手に変わる。
 */

const all: Sortable[] = [
  { id: 'a', sort_order: 1 },
  { id: 'b', sort_order: 2 },
  { id: 'c', sort_order: 3 },
  { id: 'd', sort_order: 4 },
]

test('位置を入れ替える', () => {
  assert.deepEqual(moveItem([1, 2, 3, 4], 0, 2), [2, 3, 1, 4])
  assert.deepEqual(moveItem([1, 2, 3, 4], 3, 0), [4, 1, 2, 3])
  // 動かないときは元のものをそのまま返す
  const list = [1, 2, 3]
  assert.equal(moveItem(list, 1, 1), list)
  assert.equal(moveItem(list, 0, 9), list)
  // 元の配列は変えない
  moveItem(list, 0, 2)
  assert.deepEqual(list, [1, 2, 3])
})

test('全部に1から振り直し、変わった行だけ返す', () => {
  // a を3番目へ
  assert.deepEqual(reorderedSortOrders(all, ['b', 'c', 'a', 'd']), [
    { id: 'b', sort_order: 1 },
    { id: 'c', sort_order: 2 },
    { id: 'a', sort_order: 3 },
  ])
  // 動かさなければ何も返さない
  assert.deepEqual(reorderedSortOrders(all, ['a', 'b', 'c', 'd']), [])
})

test('絞り込み中は、見えている品の場所の中だけで入れ替える', () => {
  // b と d だけが見えている（1番目と3番目の場所を占めている）状態で入れ替え
  const rows = reorderedSortOrders(all, ['d', 'b'])

  // d が b の場所へ、b が d の場所へ。a と c は動かない
  assert.deepEqual(rows, [
    { id: 'd', sort_order: 2 },
    { id: 'b', sort_order: 4 },
  ])
})

test('既定の番号が並んでいても、押した順に落ち着く', () => {
  // 追加したばかりの品は全部 100。このままだと並びが安定しない
  const fresh: Sortable[] = [
    { id: 'x', sort_order: 100 },
    { id: 'y', sort_order: 100 },
    { id: 'z', sort_order: 100 },
  ]

  assert.deepEqual(reorderedSortOrders(fresh, ['z', 'x', 'y']), [
    { id: 'z', sort_order: 1 },
    { id: 'x', sort_order: 2 },
    { id: 'y', sort_order: 3 },
  ])
})

test('知らないIDが混ざっても落ちない', () => {
  // 並べ替えている最中に別の端末で消された、のような場合
  const rows = reorderedSortOrders(all, ['b', '消えた', 'a', 'c', 'd'])
  assert.equal(Array.isArray(rows), true)
})
