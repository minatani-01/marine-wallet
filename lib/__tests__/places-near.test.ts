import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  distanceKm,
  distanceOf,
  distanceText,
  filterByNear,
  sortByDistance,
} from '../places-near'
import type { Place } from '../../types'

/** 東京駅 */
const TOKYO = { lat: 35.6812, lng: 139.7671 }

const place = (over: Partial<Place> = {}): Place => ({
  id: crypto.randomUUID(),
  kind: 'food',
  name: '店',
  area: '',
  genres: [],
  ingredients: [],
  url: '',
  note: '',
  visited_on: null,
  revisit: '',
  created_by: 'u1',
  lat: null,
  lng: null,
  business_status: '',
  status_checked_at: null,
  types_checked_at: null,
  ...over,
})

test('同じ点までの距離は0', () => {
  assert.equal(distanceKm(TOKYO, TOKYO), 0)
})

test('よく知られた距離に合う', () => {
  // 東京駅から横浜駅までは約27km
  const yokohama = { lat: 35.4657, lng: 139.6222 }
  const km = distanceKm(TOKYO, yokohama)
  assert.ok(km > 25 && km < 29, `${km}km`)

  // 東京駅から新大阪駅までは約400km
  const osaka = { lat: 34.7333, lng: 135.5003 }
  const far = distanceKm(TOKYO, osaka)
  assert.ok(far > 390 && far < 410, `${far}km`)
})

test('向きを変えても同じ距離', () => {
  const a = { lat: 35.68, lng: 139.76 }
  const b = { lat: 34.73, lng: 135.5 }
  assert.equal(distanceKm(a, b).toFixed(6), distanceKm(b, a).toFixed(6))
})

test('範囲で絞る', () => {
  const rows = [
    place({ name: '近い', lat: 35.6825, lng: 139.7675 }),
    place({ name: '横浜', lat: 35.4657, lng: 139.6222 }),
    place({ name: '大阪', lat: 34.7333, lng: 135.5003 }),
    place({ name: '座標なし' }),
  ]

  assert.deepEqual(filterByNear(rows, TOKYO, 3).map((p) => p.name), ['近い'])
  assert.deepEqual(filterByNear(rows, TOKYO, 30).map((p) => p.name), ['近い', '横浜'])
})

test('現在位置が無ければ絞らない', () => {
  const rows = [place({ name: 'あ' }), place({ name: 'い' })]
  assert.equal(filterByNear(rows, null, 3).length, 2)
  assert.equal(filterByNear(rows, TOKYO, null).length, 2)
})

test('近い順に並べ、座標の無い場所は後ろへ', () => {
  const rows = [
    place({ name: '大阪', lat: 34.7333, lng: 135.5003 }),
    place({ name: '座標なし' }),
    place({ name: '近い', lat: 35.6825, lng: 139.7675 }),
    place({ name: '横浜', lat: 35.4657, lng: 139.6222 }),
  ]
  assert.deepEqual(
    sortByDistance(rows, TOKYO).map((p) => p.name),
    ['近い', '横浜', '大阪', '座標なし']
  )
})

test('1km 未満は m で出す', () => {
  assert.equal(distanceText(0.42), '420m')
  assert.equal(distanceText(0.05), '50m')
  assert.equal(distanceText(1.24), '1.2km')
  assert.equal(distanceText(27.4), '27km')
})

test('距離が分からなければ null', () => {
  assert.equal(distanceOf(place(), TOKYO), null)
  assert.equal(distanceOf(place({ lat: 35.68, lng: 139.76 }), null), null)
  assert.ok((distanceOf(place({ lat: 35.6825, lng: 139.7675 }), TOKYO) ?? 99) < 1)
})
