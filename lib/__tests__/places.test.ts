import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  filterByGenres,
  filterByIngredients,
  filterByKind,
  filterByPrice,
  priceLabel,
  toggleTag,
  genresOf,
  hasGenre,
  isVisited,
  mapsUrl,
  placeKindLabel,
  revisitPatch,
  searchPlaces,
  splitPlaces,
} from '../places'
import type { Place } from '../../types'

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
  price_band: '',
  created_by: 'u1',
  lat: null,
  lng: null,
  business_status: '',
  status_checked_at: null,
  types_checked_at: null,
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
    place({ genres: ['焼肉'], name: '焼肉屋' }),
    place({ genres: ['寿司'], name: '寿司屋' }),
    place({ genres: [], name: 'ジャンル無し' }),
  ]

  assert.deepEqual(filterByGenres(list, ['焼肉']).map((p) => p.name), ['焼肉屋'])
  assert.equal(filterByGenres(list, []).length, 3)
})

test('同じ軸で複数選ぶと「どれか」で絞る', () => {
  const list = [
    place({ genres: ['焼肉'], name: '焼肉屋' }),
    place({ genres: ['寿司'], name: '寿司屋' }),
    place({ genres: ['蕎麦'], name: '蕎麦屋' }),
  ]

  assert.deepEqual(
    filterByGenres(list, ['焼肉', '寿司']).map((p) => p.name),
    ['焼肉屋', '寿司屋']
  )
})

test('ジャンルと食材は掛け合わせて効く', () => {
  const rows = [
    place({ name: '牛の焼肉', genres: ['焼肉'], ingredients: ['牛'] }),
    place({ name: '豚の焼肉', genres: ['焼肉'], ingredients: ['豚'] }),
    place({ name: '牛の鉄板', genres: ['鉄板焼'], ingredients: ['牛'] }),
  ]

  // ひとつの値で持っていたころは、この組み合わせを同時に選べなかった
  assert.deepEqual(
    filterByIngredients(filterByGenres(rows, ['焼肉']), ['牛']).map((p) => p.name),
    ['牛の焼肉']
  )
})

test('価格帯で絞る', () => {
  const rows = [
    place({ name: '低', price_band: 'low' }),
    place({ name: '中', price_band: 'mid' }),
    place({ name: '高', price_band: 'high' }),
    place({ name: '未設定', price_band: '' }),
  ]

  assert.deepEqual(filterByPrice(rows, ['low']).map((p) => p.name), ['低'])
  assert.deepEqual(
    filterByPrice(rows, ['low', 'high']).map((p) => p.name),
    ['低', '高']
  )
  // 選ばなければ全部。未設定の場所を隠してしまわない
  assert.equal(filterByPrice(rows, []).length, 4)
})

test('価格帯の言葉は、決めていなければ出さない', () => {
  assert.equal(priceLabel('low'), '低')
  assert.equal(priceLabel('mid'), '中')
  assert.equal(priceLabel('high'), '高')
  assert.equal(priceLabel(''), null)
})

test('札は押すと付き、もう一度押すと外れる', () => {
  assert.deepEqual(toggleTag<string>([], '牛'), ['牛'])
  assert.deepEqual(toggleTag(['牛'], '豚'), ['牛', '豚'])
  assert.deepEqual(toggleTag(['牛', '豚'], '牛'), ['豚'])
})

test('絞り込みに出すジャンルは、実際に入っている言葉だけ', () => {
  // 候補の一覧から作ると、0件のボタンが並ぶ
  const list = [place({ genres: ['焼肉'] }), place({ genres: ['寿司'] }), place({ genres: ['焼肉'] }), place({ genres: [] })]

  assert.deepEqual(genresOf(list), ['寿司', '焼肉'])
  assert.deepEqual(genresOf([]), [])
})

test('言葉で探す（名前・場所・ジャンル・メモ）', () => {
  const list = [
    place({ name: '寿司大', area: '幕張', genres: ['寿司'] }),
    place({ name: '焼肉たなか', area: '幕張', genres: ['焼肉'] }),
    place({ name: 'カフェ', area: '横浜', genres: ['カフェ'], note: '焼肉のあとに' }),
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

test('ジャンルの並びは設定した順に従う', () => {
  const rows = [
    place({ genres: ['カフェ'] }),
    place({ genres: ['焼肉'] }),
    place({ genres: ['立ち食いそば'] }),
    place({ genres: ['寿司'] }),
  ]
  // 候補に無い「立ち食いそば」は後ろへ回す
  assert.deepEqual(genresOf(rows, ['焼肉', '寿司', 'カフェ']), [
    '焼肉',
    '寿司',
    'カフェ',
    '立ち食いそば',
  ])
  // 並びを渡さないときは五十音
  assert.deepEqual(genresOf([place({ genres: ['寿司'] }), place({ genres: ['カフェ'] })]), [
    'カフェ',
    '寿司',
  ])
})

test('リピの札を押したときの書き込み', () => {
  const today = '2026-09-18'
  // まだ行っていない場所に押すと、その日を行った日にする
  assert.deepEqual(revisitPatch({ visited_on: null, revisit: '' }, 'yes', today), {
    visited_on: today,
    revisit: 'yes',
  })
  // すでに行った場所は日付をそのままに、札だけ入れ替える
  assert.deepEqual(revisitPatch({ visited_on: '2026-08-01', revisit: 'yes' }, 'no', today), {
    visited_on: '2026-08-01',
    revisit: 'no',
  })
  // 押してある札をもう一度押すと、行きたい側へ戻す
  assert.deepEqual(revisitPatch({ visited_on: '2026-08-01', revisit: 'no' }, 'no', today), {
    visited_on: null,
    revisit: '',
  })
})

test('ジャンルでも食材でも絞れる', () => {
  const rows = [
    place({ name: '焼肉たなか', genres: ['焼肉'], ingredients: ['牛', '豚'] }),
    place({ name: '鴨せいろ', genres: ['蕎麦'], ingredients: ['鴨'] }),
    place({ name: '寿司大', genres: ['寿司'], ingredients: ['魚介'] }),
  ]
  assert.deepEqual(filterByGenres(rows, ['焼肉']).map((p) => p.name), ['焼肉たなか'])
  assert.deepEqual(filterByIngredients(rows, ['鴨']).map((p) => p.name), ['鴨せいろ'])
  assert.deepEqual(filterByIngredients(rows, ['牛']).map((p) => p.name), ['焼肉たなか'])
})

test('ジャンルを複数持てる', () => {
  const rows = [place({ name: '大衆焼肉', genres: ['焼肉', '居酒屋'] })]
  // どちらで絞っても出る
  assert.equal(filterByGenres(rows, ['焼肉']).length, 1)
  assert.equal(filterByGenres(rows, ['居酒屋']).length, 1)
  assert.deepEqual(genresOf(rows, ['焼肉', '居酒屋']), ['焼肉', '居酒屋'])
})

test('食材の一覧も設定した順に出す', async () => {
  const { ingredientsOf } = await import('../places')
  const rows = [place({ ingredients: ['鴨', '牛'] }), place({ ingredients: ['豚'] })]
  assert.deepEqual(ingredientsOf(rows, ['牛', '豚', '鴨']), ['牛', '豚', '鴨'])
})

test('食材も言葉で探せる', () => {
  const rows = [
    place({ name: 'そば処', genres: ['蕎麦'], ingredients: ['鴨'] }),
    place({ name: '寿司大', genres: ['寿司'], ingredients: ['魚介'] }),
  ]
  assert.deepEqual(searchPlaces(rows, '鴨').map((p) => p.name), ['そば処'])
})
