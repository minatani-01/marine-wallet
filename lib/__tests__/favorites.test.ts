import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ALL_GENRES,
  filterByGenre,
  genresOf,
  imageSrc,
  isBorrowedImage,
  parsePrice,
  priceText,
  rejectReason,
  sortItems,
} from '@/lib/favorites'
import type { FavoriteItem } from '@/types'

const item = (over: Partial<FavoriteItem> = {}): FavoriteItem => ({
  id: 'x',
  user_id: 'u',
  genre: '食品',
  name: '品',
  brand: '',
  image_path: '',
  image_url: '',
  price: null,
  memo: '',
  status: '欲しい',
  shop_name: '',
  shop_url: '',
  sort_order: 100,
  active: true,
  created_at: '',
  updated_at: '',
  ...over,
})

test('表示順 → ジャンル → 名前で並べる', () => {
  const sorted = sortItems([
    item({ id: 'c', sort_order: 2, genre: '食品', name: 'さ' }),
    item({ id: 'a', sort_order: 1, genre: '美容', name: 'あ' }),
    // 表示順が同じときはジャンル、それも同じなら名前
    item({ id: 'd', sort_order: 2, genre: '食品', name: 'か' }),
    item({ id: 'b', sort_order: 2, genre: '美容', name: 'あ' }),
  ])

  assert.deepEqual(
    sorted.map((i) => i.id),
    ['a', 'd', 'c', 'b']
  )
})

test('並べ替えても元の配列は変えない', () => {
  const items = [item({ id: 'b', sort_order: 2 }), item({ id: 'a', sort_order: 1 })]
  sortItems(items)
  assert.equal(items[0].id, 'b')
})

test('ジャンルは品の多い順に出す', () => {
  const genres = genresOf([
    item({ genre: '美容' }),
    item({ genre: '食品' }),
    item({ genre: '食品' }),
    item({ genre: '食品' }),
    item({ genre: '美容' }),
    item({ genre: '日用品' }),
  ])

  assert.deepEqual(genres, ['食品', '美容', '日用品'])
  // 使っていないジャンルは出さない。押しても空になる絞り込みを作らない
  assert.deepEqual(genresOf([]), [])
})

test('ジャンルで絞る。すべてなら絞らない', () => {
  const items = [item({ id: 'a', genre: '食品' }), item({ id: 'b', genre: '美容' })]

  assert.deepEqual(
    filterByGenre(items, '食品').map((i) => i.id),
    ['a']
  )
  assert.equal(filterByGenre(items, ALL_GENRES).length, 2)
})

test('画像は上げたものを先に見る', () => {
  const signed = new Map([['u/1.jpg', 'https://signed.example/1.jpg']])

  // 上げたもの
  assert.equal(imageSrc(item({ image_path: 'u/1.jpg' }), signed), 'https://signed.example/1.jpg')
  // 移行ぶん。借りているURLしか持たない
  assert.equal(
    imageSrc(item({ image_url: 'https://drive.example/x' }), signed),
    'https://drive.example/x'
  )
  // 両方あれば上げたほうを使う
  assert.equal(
    imageSrc(item({ image_path: 'u/1.jpg', image_url: 'https://drive.example/x' }), signed),
    'https://signed.example/1.jpg'
  )
  // 署名が出せなかった。枠だけ出す
  assert.equal(imageSrc(item({ image_path: 'u/2.jpg' }), signed), null)
  assert.equal(imageSrc(item(), signed), null)
})

test('まだ Drive 任せのものを見分ける', () => {
  assert.equal(isBorrowedImage(item({ image_url: 'https://drive.example/x' })), true)
  // 入れ直したあと
  assert.equal(
    isBorrowedImage(item({ image_path: 'u/1.jpg', image_url: 'https://drive.example/x' })),
    false
  )
  assert.equal(isBorrowedImage(item()), false)
})

test('価格は分からないものと0円を区別する', () => {
  assert.equal(priceText(6480), '¥6,480')
  assert.equal(priceText(0), '¥0')
  assert.equal(priceText(null), '')
})

test('入力を確かめる', () => {
  const ok = { name: 'そうめん', price: '6480', shop_url: 'https://example.com/x' }
  assert.equal(rejectReason(ok), null)

  assert.match(String(rejectReason({ ...ok, name: '  ' })), /商品名/)
  assert.match(String(rejectReason({ ...ok, price: 'いくらか' })), /価格/)
  assert.match(String(rejectReason({ ...ok, price: '-1' })), /価格/)
  // 押した人の画面で動くものをリンクにしない
  assert.match(String(rejectReason({ ...ok, shop_url: 'javascript:alert(1)' })), /購入URL/)

  // 価格もURLも空でよい
  assert.equal(rejectReason({ name: 'そうめん', price: '', shop_url: '' }), null)
})

test('価格は空なら null。0円と区別する', () => {
  assert.equal(parsePrice('6480'), 6480)
  assert.equal(parsePrice('0'), 0)
  assert.equal(parsePrice(''), null)
  assert.equal(parsePrice('  '), null)
  // 小数は丸める。円に小数は無い
  assert.equal(parsePrice('780.4'), 780)
})
