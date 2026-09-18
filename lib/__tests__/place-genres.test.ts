import { test } from 'node:test'
import assert from 'node:assert/strict'

import { reorderGenres } from '../place-genres'
import type { PlaceGenre } from '../../types'

const list = (...names: string[]): PlaceGenre[] =>
  names.map((name, index) => ({ id: name, name, sort_order: (index + 1) * 10 }))

test('1つ上へ動かす', () => {
  const { rows, changed } = reorderGenres(list('焼肉', '寿司', 'ラーメン'), 'ラーメン', -1)
  assert.deepEqual(rows.map((r) => r.name), ['焼肉', 'ラーメン', '寿司'])
  // 動いた2つだけを書き戻す
  assert.deepEqual(changed, [
    { id: 'ラーメン', sort_order: 20 },
    { id: '寿司', sort_order: 30 },
  ])
})

test('1つ下へ動かす', () => {
  const { rows } = reorderGenres(list('焼肉', '寿司', 'ラーメン'), '焼肉', 1)
  assert.deepEqual(rows.map((r) => r.name), ['寿司', '焼肉', 'ラーメン'])
})

test('端では何も起きない', () => {
  const genres = list('焼肉', '寿司')
  assert.deepEqual(reorderGenres(genres, '焼肉', -1).changed, [])
  assert.deepEqual(reorderGenres(genres, '寿司', 1).changed, [])
  // 知らない id でも壊れない
  assert.deepEqual(reorderGenres(genres, 'うどん', -1).rows, genres)
})

test('同じ並び順が並んでいても動く', () => {
  // 既定値のまま足すと 100 が並ぶ。隣と入れ替えるだけだと何も起きない
  const genres: PlaceGenre[] = [
    { id: 'a', name: 'あ', sort_order: 100 },
    { id: 'b', name: 'い', sort_order: 100 },
    { id: 'c', name: 'う', sort_order: 100 },
  ]
  const { rows, changed } = reorderGenres(genres, 'c', -1)
  assert.deepEqual(rows.map((r) => r.id), ['a', 'c', 'b'])
  assert.deepEqual(changed, [
    { id: 'a', sort_order: 10 },
    { id: 'c', sort_order: 20 },
    { id: 'b', sort_order: 30 },
  ])
})
