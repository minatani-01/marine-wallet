import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  filterByGenre,
  filterByKind,
  genresOf,
  hasGenre,
  isVisited,
  mapsUrl,
  placeKindLabel,
  searchPlaces,
  splitPlaces,
} from '../places'
import type { Place } from '../../types'

const place = (over: Partial<Place> = {}): Place => ({
  id: crypto.randomUUID(),
  kind: 'food',
  name: '店',
  area: '',
  genre: '',
  url: '',
  note: '',
  visited_on: null,
  created_by: 'u1',
  lat: null,
  lng: null,
  business_status: '',
  status_checked_at: null,
  ...over,
})

test('行った日の有無で2つのリストに分ける', () => {
  const { wish, visited } = splitPlaces([
    place({ name: '行きたい店' }),
    place({ name: '行った店', visited_on: '2026-08-01' }),
  ])

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
  assert.equal(filterByKind(list, null).length, 2)
})

test('ジャンルで絞る', () => {
  const list = [
    place({ genre: '焼肉', name: '焼肉屋' }),
    place({ genre: '寿司', name: '寿司屋' }),
    place({ genre: '', name: 'ジャンル無し' }),
  ]

  assert.deepEqual(filterByGenre(list, '焼肉').map((p) => p.name), ['焼肉屋'])
  assert.equal(filterByGenre(list, null).length, 3)
})

test('絞り込みに出すジャンルは、実際に入っている言葉だけ', () => {
  // 候補の一覧から作ると、0件のボタンが並ぶ
  const list = [place({ genre: '焼肉' }), place({ genre: '寿司' }), place({ genre: '焼肉' }), place({ genre: '' })]

  assert.deepEqual(genresOf(list), ['寿司', '焼肉'])
  assert.deepEqual(genresOf([]), [])
})

test('言葉で探す（名前・場所・ジャンル・メモ）', () => {
  const list = [
    place({ name: '寿司大', area: '幕張', genre: '寿司' }),
    place({ name: '焼肉たなか', area: '幕張', genre: '焼肉' }),
    place({ name: 'カフェ', area: '横浜', genre: 'カフェ', note: '焼肉のあとに' }),
  ]

  assert.deepEqual(searchPlaces(list, '寿司').map((p) => p.name), ['寿司大'])
  assert.deepEqual(searchPlaces(list, '幕張').map((p) => p.name), ['寿司大', '焼肉たなか'])
  // メモも見る
  assert.deepEqual(searchPlaces(list, '焼肉').map((p) => p.name), ['焼肉たなか', 'カフェ'])
  // 空白で区切った語は「すべて含む」
  assert.deepEqual(searchPlaces(list, '幕張 焼肉').map((p) => p.name), ['焼肉たなか'])
  assert.equal(searchPlaces(list, '   ').length, 3)
})

test('Google マップのリンクは鍵の要らない形', () => {
  const url = mapsUrl({ name: '寿司 大', area: '幕張' })

  assert.ok(url.startsWith('https://www.google.com/maps/search/?api=1&query='))
  assert.equal(decodeURIComponent(url.split('query=')[1]), '幕張 寿司 大')
})

test('場所の手がかりが無くても開ける', () => {
  assert.equal(decodeURIComponent(mapsUrl({ name: '通天閣', area: '' }).split('query=')[1]), '通天閣')
})

test('ラベル', () => {
  assert.equal(placeKindLabel('sight'), '観光地')
  assert.equal(placeKindLabel('food'), '飲食')
  assert.equal(isVisited({ visited_on: '2026-09-01' }), true)
  assert.equal(isVisited({ visited_on: null }), false)
})

test('ジャンルを持つのは飲食だけ', () => {
  // 観光地は「名所」「公園」と分けても、並ぶ数が少なく分ける意味が薄い
  assert.equal(hasGenre('food'), true)
  assert.equal(hasGenre('sight'), false)
})
