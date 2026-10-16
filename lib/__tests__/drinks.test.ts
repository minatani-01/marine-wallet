import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_INGREDIENTS, ingredientLines, rejectRecipeReason } from '@/lib/drinks'

test('材料は1行1つに割る。空の行は落とす', () => {
  assert.deepEqual(ingredientLines('水 300ml\nプロテイン 30g'), ['水 300ml', 'プロテイン 30g'])

  // 貼り付けたときの末尾の改行や、書いている途中の空行が箇条書きになると困る
  assert.deepEqual(ingredientLines('水 300ml\n\n\nレモン汁 小さじ1\n'), [
    '水 300ml',
    'レモン汁 小さじ1',
  ])
  assert.deepEqual(ingredientLines('  水 300ml  \n\t'), ['水 300ml'])
  assert.deepEqual(ingredientLines(''), [])
  assert.deepEqual(ingredientLines('\n \n'), [])
})

test('入力を確かめる', () => {
  assert.equal(rejectRecipeReason({ name: '断食明け', ingredients: '水 300ml' }), null)
  // 材料が無くてもよい。名前だけ先に置いておけるほうが残る
  assert.equal(rejectRecipeReason({ name: '断食明け', ingredients: '' }), null)

  assert.match(String(rejectRecipeReason({ name: '  ', ingredients: '水' })), /名前/)

  const many = Array.from({ length: MAX_INGREDIENTS + 1 }, (_, i) => `材料${i}`).join('\n')
  assert.match(String(rejectRecipeReason({ name: 'たくさん', ingredients: many })), /材料/)

  // ちょうど上限なら通る
  const just = Array.from({ length: MAX_INGREDIENTS }, (_, i) => `材料${i}`).join('\n')
  assert.equal(rejectRecipeReason({ name: 'ちょうど', ingredients: just }), null)
})
