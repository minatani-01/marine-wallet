import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_ITEMS,
  cleanItems,
  itemText,
  needsAmount,
  rejectRecipeReason,
  toItems,
  type DrinkItem,
} from '@/lib/drinks'

const item = (over: Partial<DrinkItem> = {}): DrinkItem => ({
  name: '水',
  amount: 300,
  unit: 'ml',
  ...over,
})

test('日本語の言い方に合わせて書く', () => {
  assert.equal(itemText(item()), '水 300ml')
  assert.equal(itemText(item({ name: 'プロテイン', amount: 30, unit: 'g' })), 'プロテイン 30g')

  // 小さじ・大さじは数より先。「1小さじ」とは言わない
  assert.equal(itemText(item({ name: 'レモン汁', amount: 1, unit: '小さじ' })), 'レモン汁 小さじ1')
  assert.equal(itemText(item({ name: 'みりん', amount: 2, unit: '大さじ' })), 'みりん 大さじ2')

  // 適量に数は無い
  assert.equal(itemText(item({ name: '氷', amount: null, unit: '適量' })), '氷 適量')
  assert.equal(needsAmount('適量'), false)
  assert.equal(needsAmount('ml'), true)
})

test('DB から来たものをそのまま信じない', () => {
  assert.deepEqual(toItems([{ name: '水', amount: 300, unit: 'ml' }]), [
    { name: '水', amount: 300, unit: 'ml' },
  ])

  // 知らない単位は既定に寄せる。欠けている値も埋める
  assert.deepEqual(toItems([{ name: '水', amount: 300, unit: 'cc' }]), [
    { name: '水', amount: 300, unit: 'ml' },
  ])
  assert.deepEqual(toItems([{ name: '水' }]), [{ name: '水', amount: null, unit: 'ml' }])

  // 形が違っていても落とさない。1件のために画面全体が出ないほうが困る
  assert.deepEqual(toItems(null), [])
  assert.deepEqual(toItems('水 300ml'), [])
  assert.deepEqual(toItems([null, 3, { name: '水', amount: 1, unit: 'L' }]), [
    { name: '水', amount: 1, unit: 'L' },
  ])
  assert.deepEqual(toItems([{ name: '水', amount: Number.NaN, unit: 'ml' }]), [
    { name: '水', amount: null, unit: 'ml' },
  ])
})

test('書きかけの行は保存しない', () => {
  assert.deepEqual(cleanItems([item(), item({ name: '  ' }), item({ name: '' })]), [item()])
  assert.deepEqual(cleanItems([item({ name: '  水  ' })]), [item()])

  // 適量に数が残っていても落とす
  assert.deepEqual(cleanItems([item({ name: '氷', amount: 5, unit: '適量' })]), [
    { name: '氷', amount: null, unit: '適量' },
  ])
})

test('入力を確かめる', () => {
  assert.equal(rejectRecipeReason({ name: '断食明け', items: [item()] }), null)
  // 材料が無くてもよい。名前だけ先に置いておけるほうが残る
  assert.equal(rejectRecipeReason({ name: '断食明け', items: [] }), null)
  // 書きかけの行だけなら、無いのと同じ
  assert.equal(rejectRecipeReason({ name: '断食明け', items: [item({ name: '' })] }), null)

  assert.match(String(rejectRecipeReason({ name: '  ', items: [] })), /名前/)

  // 数の要る単位で、数が入っていない
  assert.match(
    String(rejectRecipeReason({ name: 'x', items: [item({ name: 'プロテイン', amount: null })] })),
    /プロテイン/
  )
  assert.match(
    String(rejectRecipeReason({ name: 'x', items: [item({ name: 'プロテイン', amount: 0 })] })),
    /プロテイン/
  )
  // 適量なら数が無くてよい
  assert.equal(
    rejectRecipeReason({ name: 'x', items: [item({ name: '氷', amount: null, unit: '適量' })] }),
    null
  )

  const many = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => item({ name: `材料${i}` }))
  assert.match(String(rejectRecipeReason({ name: 'たくさん', items: many })), /材料/)
  assert.equal(rejectRecipeReason({ name: 'ちょうど', items: many.slice(0, MAX_ITEMS) }), null)
})
