import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fitWithin } from '@/lib/receipt'

test('長辺を上限に収め、縦横の比は変えない', () => {
  // 縦に長いレシート
  assert.deepEqual(fitWithin(3000, 4000, 1400), { width: 1050, height: 1400 })
  // 横長
  assert.deepEqual(fitWithin(4000, 3000, 1400), { width: 1400, height: 1050 })
  // 正方形
  assert.deepEqual(fitWithin(2000, 2000, 1400), { width: 1400, height: 1400 })
})

test('もとが小さいときは引き伸ばさない', () => {
  // 粗い画像を大きくしても読めるようにならず、容量だけ増える
  assert.deepEqual(fitWithin(800, 1200, 1400), { width: 800, height: 1200 })
  assert.deepEqual(fitWithin(1400, 700, 1400), { width: 1400, height: 700 })
})

test('極端な比でも1pxを下回らせない', () => {
  // canvas は 0 を受け取れない
  const thin = fitWithin(20000, 5, 1400)
  assert.equal(thin.width, 1400)
  assert.equal(thin.height, 1)
})

test('大きさが取れなかったときは0を返す', () => {
  assert.deepEqual(fitWithin(0, 0, 1400), { width: 0, height: 0 })
})
