import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  filterByKind,
  groupByStadium,
  isVisited,
  mapsUrl,
  placeKindLabel,
  placeStadiumLabel,
  splitPlaces,
} from '../places'
import type { Place } from '../../types'

const place = (over: Partial<Place> = {}): Place => ({
  id: crypto.randomUUID(),
  kind: 'food',
  name: '店',
  area: '',
  url: '',
  note: '',
  stadium_id: null,
  visited_on: null,
  created_by: 'u1',
  ...over,
})

test('行った日の有無で2つのリストに分ける', () => {
  const a = place({ name: '行きたい店' })
  const b = place({ name: '行った店', visited_on: '2026-08-01' })

  const { wish, visited } = splitPlaces([a, b])

  assert.deepEqual(wish.map((p) => p.name), ['行きたい店'])
  assert.deepEqual(visited.map((p) => p.name), ['行った店'])
})

test('行った場所は新しい順', () => {
  const list = splitPlaces([
    place({ name: '古い', visited_on: '2026-05-01' }),
    place({ name: '新しい', visited_on: '2026-09-01' }),
    place({ name: '中', visited_on: '2026-07-01' }),
  ]).visited

  assert.deepEqual(list.map((p) => p.name), ['新しい', '中', '古い'])
})

test('種別で絞る', () => {
  const list = [place({ kind: 'food', name: '店' }), place({ kind: 'sight', name: '城' })]

  assert.deepEqual(filterByKind(list, 'food').map((p) => p.name), ['店'])
  assert.deepEqual(filterByKind(list, 'sight').map((p) => p.name), ['城'])
  // 絞らないときは全部
  assert.equal(filterByKind(list, null).length, 2)
})

test('Google マップのリンクは鍵の要らない形', () => {
  const url = mapsUrl({ name: '寿司 大', area: '幕張' })

  assert.ok(url.startsWith('https://www.google.com/maps/search/?api=1&query='))
  // 場所の手がかりを混ぜる（同名の別店舗に飛ばさない）
  assert.equal(decodeURIComponent(url.split('query=')[1]), '幕張 寿司 大')
})

test('場所の手がかりが無くても開ける', () => {
  assert.equal(decodeURIComponent(mapsUrl({ name: '通天閣', area: '' }).split('query=')[1]), '通天閣')
})

test('近くの球場を引く', () => {
  assert.equal(placeStadiumLabel({ stadium_id: 'zozo' }), 'ZOZOマリン')
  assert.equal(placeStadiumLabel({ stadium_id: null }), null)
  // 知らない球場は出さない（消えた id をそのまま画面に出さない）
  assert.equal(placeStadiumLabel({ stadium_id: 'nowhere' }), null)
})

test('球場ごとにまとめ、結び付けていないものは最後', () => {
  const groups = groupByStadium([
    place({ name: 'A', stadium_id: 'zozo' }),
    place({ name: 'B', stadium_id: null }),
    place({ name: 'C', stadium_id: 'zozo' }),
    place({ name: 'D', stadium_id: 'koshien' }),
  ])

  assert.deepEqual(
    groups.map((g) => g.label),
    ['ZOZOマリン', '甲子園', 'その他']
  )
  assert.deepEqual(groups[0].places.map((p) => p.name), ['A', 'C'])
})

test('ラベル', () => {
  assert.equal(placeKindLabel('sight'), '観光地')
  assert.equal(placeKindLabel('food'), '飲食')
  assert.equal(isVisited({ visited_on: '2026-09-01' }), true)
  assert.equal(isVisited({ visited_on: null }), false)
})
