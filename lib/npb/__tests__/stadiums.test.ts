import { test } from 'node:test'
import assert from 'node:assert/strict'

import { HOME_STADIUMS, STADIUMS, stadiumById, stadiumOf } from '../../stadiums'

/**
 * npb.jp に実際に現れた表記。2026年シーズンの取得データから採った。
 * ここが引けなくなると、過去のスタンプが静かに外れる。
 */
const FROM_NPB = [
  'ZOZOマリン',
  'エスコンＦ',
  'ベルーナドーム',
  'マツダスタジアム',
  'みずほPayPay',
  '京セラD大阪',
  '前 橋',
  '東京ドーム',
  '楽天モバイル',
  '熊 本',
  '県営大宮',
  '神 宮',
  '郡 山',
  '鹿児島',
]

test('npb.jp の表記をすべて引ける', () => {
  const missed = FROM_NPB.filter((place) => stadiumOf(place) === null)
  assert.deepEqual(missed, [])
})

test('全角スペースや全角英字を含む表記も引ける', () => {
  assert.equal(stadiumOf('エスコンＦ')?.id, 'escon')
  assert.equal(stadiumOf('神 宮')?.id, 'jingu')
  assert.equal(stadiumOf('熊 本')?.id, 'kumamoto')
})

test('昔の名前でも引ける（命名権が変わっても過去のスタンプを外さない）', () => {
  assert.equal(stadiumOf('QVCマリン')?.id, 'zozo')
  assert.equal(stadiumOf('メットライフドーム')?.id, 'belluna')
  assert.equal(stadiumOf('ヤフオクドーム')?.id, 'mizuho_paypay')
  assert.equal(stadiumOf('ナゴヤドーム')?.id, 'vantelin')
})

test('知らない球場は null（勝手にどこかへ寄せない）', () => {
  assert.equal(stadiumOf('どこかの球場'), null)
  assert.equal(stadiumOf(''), null)
})

test('本拠地は12球団ぶんあり、球団が重複しない', () => {
  assert.equal(HOME_STADIUMS.length, 12)
  const teams = HOME_STADIUMS.map((s) => s.team)
  assert.equal(new Set(teams).size, 12)
})

test('id が重複しない', () => {
  assert.equal(new Set(STADIUMS.map((s) => s.id)).size, STADIUMS.length)
})

test('id から引ける', () => {
  assert.equal(stadiumById('zozo')?.short, 'ZOZOマリン')
  assert.equal(stadiumById('nowhere'), null)
})

test('券面に出す文字がすべて埋まっている', () => {
  // 1つでも空だと、その球場だけスタンプが崩れる
  const blank = STADIUMS.filter(
    (s) => !s.nameEn || !s.prefecture || !s.prefectureEn || !s.regionEn
  )
  assert.deepEqual(blank.map((s) => s.id), [])
})
