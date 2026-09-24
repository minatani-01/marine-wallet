import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  classificationPatch,
  classifyPlace,
  genresFromTypes,
  isFoodType,
  kindFromTypes,
  mergeGenres,
} from '../places-types'

test('料理の種類はすべて飲食として扱う', () => {
  assert.equal(isFoodType('sushi_restaurant'), true)
  assert.equal(isFoodType('vietnamese_restaurant'), true)
  // 表に無い料理が増えても拾える
  assert.equal(isFoodType('mongolian_restaurant'), true)
  assert.equal(isFoodType('cafe'), true)
  assert.equal(isFoodType('bakery'), true)
})

test('店なら何でも飲食にはしない', () => {
  assert.equal(isFoodType('bicycle_shop'), false)
  assert.equal(isFoodType('shoe_store'), false)
  assert.equal(isFoodType('park'), false)
  assert.equal(isFoodType('tourist_attraction'), false)
})

test('種別は飲食か、それ以外か', () => {
  assert.equal(kindFromTypes(['sushi_restaurant', 'restaurant', 'food']), 'food')
  assert.equal(kindFromTypes(['park', 'tourist_attraction']), 'sight')
  assert.equal(kindFromTypes(['stadium']), 'sight')
  // 何も分からなければ触らない
  assert.equal(kindFromTypes([]), null)
})

test('ジャンルは主な種類から先に取る', () => {
  assert.deepEqual(
    genresFromTypes('sushi_restaurant', ['sushi_restaurant', 'restaurant', 'food']),
    ['寿司']
  )
  assert.deepEqual(genresFromTypes('ramen_restaurant', ['ramen_restaurant']), ['ラーメン'])
})

test('ジャンルは2つまで', () => {
  const genres = genresFromTypes('barbecue_restaurant', [
    'barbecue_restaurant',
    'korean_restaurant',
    'japanese_restaurant',
    'restaurant',
  ])
  assert.deepEqual(genres, ['焼肉', '韓国料理'])
})

test('表に無い料理は Google の日本語の呼び名を使う', () => {
  assert.deepEqual(
    genresFromTypes('mongolian_restaurant', ['mongolian_restaurant', 'restaurant'], 'ジンギスカン店'),
    ['ジンギスカン店']
  )
})

test('中身を表さない種類では呼び名を入れない', () => {
  // 「レストラン」と付いても何の店か分からず、札が増えるだけになる
  assert.deepEqual(genresFromTypes('restaurant', ['restaurant', 'food'], 'レストラン'), [])
  assert.deepEqual(genresFromTypes('', ['food'], ''), [])
})

test('観光地にジャンルは付けない', () => {
  assert.deepEqual(classifyPlace('park', ['park', 'tourist_attraction'], '公園'), {
    kind: 'sight',
    genres: [],
  })
})

test('飲食は種別とジャンルの両方が決まる', () => {
  assert.deepEqual(
    classifyPlace('sushi_restaurant', ['sushi_restaurant', 'restaurant', 'food'], '寿司店'),
    { kind: 'food', genres: ['寿司'] }
  )
})

test('種類が主なものしか無くても判断する', () => {
  assert.deepEqual(classifyPlace('cafe', [], 'カフェ'), { kind: 'food', genres: ['カフェ'] })
})

test('ジャンルは足すだけで、消さない', () => {
  assert.deepEqual(mergeGenres(['焼肉'], ['寿司']), ['焼肉', '寿司'])
  // 同じ言葉は二度入れない
  assert.deepEqual(mergeGenres(['寿司'], ['寿司']), ['寿司'])
  assert.deepEqual(mergeGenres([], []), [])
})

test('同じものを指す言葉は、両方付けない', () => {
  // コーヒーの店に「カフェ」を足すと札が2つになり、絞り込みが割れる。
  // どちらの言葉を使うかは、入れた人の決めたほうに合わせる
  assert.deepEqual(mergeGenres(['コーヒー'], ['カフェ']), ['コーヒー'])
  assert.deepEqual(mergeGenres(['カフェ'], ['カフェ']), ['カフェ'])
  assert.deepEqual(mergeGenres(['喫茶'], ['カフェ']), ['喫茶'])
  assert.deepEqual(mergeGenres(['バル'], ['バー']), ['バル'])
  // 取り込みでも同じ。コーヒーの店を見に行っても札は増えない
  assert.deepEqual(
    classificationPatch({ kind: 'food', genres: ['コーヒー'] }, 'coffee_shop', ['coffee_shop']),
    { kind: 'food', genres: ['コーヒー'] }
  )
})

test('書き込む内容は、いま入っているものに足す形で作る', () => {
  const current = { kind: 'food', genres: ['居酒屋'] }
  assert.deepEqual(
    classificationPatch(current, 'ramen_restaurant', ['ramen_restaurant', 'restaurant']),
    { kind: 'food', genres: ['居酒屋', 'ラーメン'] }
  )
})

test('観光地に変わっても、付いていたジャンルは消さない', () => {
  // 手で入れたものを黙って消すと、直したことが無かったことになる。
  // 観光地のジャンルは画面に出ないので、残っていても邪魔にならない
  const current = { kind: 'food', genres: ['カフェ'] }
  assert.deepEqual(classificationPatch(current, 'park', ['park', 'tourist_attraction'], '公園'), {
    kind: 'sight',
    genres: ['カフェ'],
  })
})

test('種類が分からなければ種別に触らない', () => {
  const patch = classificationPatch({ kind: 'food', genres: [] }, '', [], '')
  assert.equal('kind' in patch, false)
  assert.deepEqual(patch.genres, [])
})
