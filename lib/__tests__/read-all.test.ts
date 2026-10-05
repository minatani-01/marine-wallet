import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readAll } from '@/lib/supabase/read-all'

/** 上限 limit 行までしか返さない問い合わせを模す */
function fakeTable(total: number, limit: number) {
  const all = Array.from({ length: total }, (_, i) => ({ i }))
  const calls: [number, number][] = []
  const page = async (from: number, to: number) => {
    calls.push([from, to])
    const end = Math.min(to + 1, from + limit, total)
    return { data: all.slice(from, Math.max(from, end)), error: null }
  }
  return { page, calls }
}

test('上限で切られても最後まで読む', async () => {
  // 本番と同じ形。1945行あって1回に1000行しか返らない
  const { page } = fakeTable(1945, 1000)
  const rows = await readAll<{ i: number }>(page)
  assert.equal(rows.length, 1945)
  assert.equal(rows[0].i, 0)
  assert.equal(rows[1944].i, 1944)
})

test('上限が1ページ分より小さくても取りこぼさない', async () => {
  const { page } = fakeTable(1200, 300)
  const rows = await readAll<{ i: number }>(page)
  assert.equal(rows.length, 1200)
  // 通し番号が飛んでいない
  assert.deepEqual(
    rows.map((r) => r.i),
    Array.from({ length: 1200 }, (_, i) => i)
  )
})

test('ちょうど上限と同じ行数でも、余分に1回だけ読んで終わる', async () => {
  const { page, calls } = fakeTable(1000, 1000)
  const rows = await readAll<{ i: number }>(page)
  assert.equal(rows.length, 1000)
  assert.equal(calls.length, 2)
})

test('空の表は1回で終わる', async () => {
  const { page, calls } = fakeTable(0, 1000)
  assert.deepEqual(await readAll(page), [])
  assert.equal(calls.length, 1)
})

test('読めなければ投げる。黙って短い結果を返さない', async () => {
  await assert.rejects(
    () => readAll(async () => ({ data: null, error: { message: '読めません' } })),
    /読めません/
  )
})
