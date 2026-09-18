import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CHECK_INTERVAL_DAYS,
  checkQuery,
  dueBefore,
  filterClosed,
  isClosed,
  normalizeName,
  sameShop,
  statusFromHit,
  statusLabel,
} from '../places-status'

test('画面に出す言葉', () => {
  assert.equal(statusLabel('CLOSED_PERMANENTLY'), '閉店')
  assert.equal(statusLabel('CLOSED_TEMPORARILY'), '休業中')
  // 営業中と未確認は何も出さない（出すと画面が印だらけになる）
  assert.equal(statusLabel('OPERATIONAL'), null)
  assert.equal(statusLabel(''), null)
})

test('閉店と休業はどちらも色を変える', () => {
  assert.equal(isClosed({ business_status: 'CLOSED_PERMANENTLY' }), true)
  assert.equal(isClosed({ business_status: 'CLOSED_TEMPORARILY' }), true)
  assert.equal(isClosed({ business_status: 'OPERATIONAL' }), false)
  assert.equal(isClosed({ business_status: '' }), false)
})

test('名前のゆれをならす', () => {
  assert.equal(normalizeName('呑毛笑店 ゑぶり亭'), '呑毛笑店ゑぶり亭')
  assert.equal(normalizeName('ＺＯＺＯ カフェ（本店）'), 'zozoカフェ本店')
  assert.equal(normalizeName('焼肉・たなか'), '焼肉たなか')
})

test('同じ店かどうかを見分ける', () => {
  assert.equal(sameShop('呑毛笑店 ゑぶり亭', '呑毛笑店ゑぶり亭'), true)
  // 支店名が付いて返ってくることがある
  assert.equal(sameShop('ゑぶり亭', 'ゑぶり亭 横浜店'), true)
  // 別の店の閉店を、こちらの店に付けない
  assert.equal(sameShop('ゑぶり亭', '寿司大'), false)
  assert.equal(sameShop('', '寿司大'), false)
})

test('確認に使う言葉には場所も混ぜる', () => {
  assert.equal(checkQuery({ name: 'ゑぶり亭', area: '幕張' }), 'ゑぶり亭 幕張')
  // 場所が空でも余分な空白を残さない
  assert.equal(checkQuery({ name: 'ゑぶり亭', area: '' }), 'ゑぶり亭')
})

test('前回から25日以上経ったものが対象になる', () => {
  const now = new Date('2026-09-18T00:00:00.000Z')
  const cutoff = new Date(dueBefore(now))
  const days = (now.getTime() - cutoff.getTime()) / (24 * 60 * 60 * 1000)
  assert.equal(days, CHECK_INTERVAL_DAYS)
})

test('同じ店だと分かったときだけ状態を書く', () => {
  assert.equal(
    statusFromHit('ゑぶり亭', { name: 'ゑぶり亭 幕張店', status: 'CLOSED_PERMANENTLY' }),
    'CLOSED_PERMANENTLY'
  )
  // 別の店が返ってきたら触らない。営業している店を閉店にしないため
  assert.equal(statusFromHit('ゑぶり亭', { name: '寿司大', status: 'CLOSED_PERMANENTLY' }), null)
  // 見つからなかった・状態が付いてこなかったときも触らない
  assert.equal(statusFromHit('ゑぶり亭', null), null)
  assert.equal(statusFromHit('ゑぶり亭', { name: 'ゑぶり亭', status: '' }), null)
})

test('閉店だけを残す', () => {
  const rows = [
    { business_status: 'OPERATIONAL', name: 'あ' },
    { business_status: 'CLOSED_PERMANENTLY', name: 'い' },
    { business_status: '', name: 'う' },
    { business_status: 'CLOSED_TEMPORARILY', name: 'え' },
  ]
  assert.deepEqual(
    filterClosed(rows).map((r) => r.name),
    ['い', 'え']
  )
})
