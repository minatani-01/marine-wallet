import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MILESTONE_KINDS, milestoneUrl, snapshotMilestonePages } from '../milestones'

/** 保存しようとした中身を覚えておくだけの Supabase 代わり */
function fakeSupabase(failOn: string[] = []) {
  const saved: Record<string, unknown>[] = []
  const supabase = {
    from() {
      return {
        upsert(row: Record<string, unknown>) {
          if (failOn.includes(row.kind as string)) {
            return Promise.resolve({ error: { message: '書けません' } })
          }
          saved.push(row)
          return Promise.resolve({ error: null })
        },
      }
    },
  }
  return { supabase, saved }
}

test('3種類のページのURLを組み立てる', () => {
  assert.equal(milestoneUrl('batting', 2026), 'https://npb.jp/history/2026/milestones_b.html')
  assert.equal(milestoneUrl('pitching', 2026), 'https://npb.jp/history/2026/milestones_p.html')
  assert.equal(milestoneUrl('team', 2026), 'https://npb.jp/history/2026/milestones_team.html')
  // 年が変わればURLも変わる
  assert.equal(milestoneUrl('batting', 2027), 'https://npb.jp/history/2027/milestones_b.html')
})

test('3ページとも取って保存する', async () => {
  const { supabase, saved } = fakeSupabase()
  const urls: string[] = []

  const result = await snapshotMilestonePages(supabase as never, 2026, async (url) => {
    urls.push(url)
    return '<html>記録</html>'
  })

  assert.equal(result.saved, 3)
  assert.equal(urls.length, 3)
  assert.deepEqual(saved.map((r) => r.kind), [...MILESTONE_KINDS])
  assert.equal(saved[0].season, 2026)
})

test('空の中身は保存しない（記録なしと誤解される）', async () => {
  const { supabase, saved } = fakeSupabase()
  const result = await snapshotMilestonePages(supabase as never, 2026, async () => '   ')
  assert.equal(result.saved, 0)
  assert.equal(saved.length, 0)
  assert.match(result.items[0].reason ?? '', /空/)
})

test('1ページ落ちても、残りは取りに行く', async () => {
  const { supabase, saved } = fakeSupabase()
  const result = await snapshotMilestonePages(supabase as never, 2026, async (url) => {
    if (url.includes('milestones_p')) throw new Error('接続できません')
    return '<html>記録</html>'
  })

  assert.equal(result.saved, 2)
  assert.deepEqual(saved.map((r) => r.kind), ['batting', 'team'])
  const failed = result.items.find((i) => i.kind === 'pitching')
  assert.equal(failed?.status, 'failed')
  assert.match(failed?.reason ?? '', /取得できませんでした/)
})

test('保存に失敗したページは saved に数えない', async () => {
  const { supabase } = fakeSupabase(['team'])
  const result = await snapshotMilestonePages(supabase as never, 2026, async () => '<html>記録</html>')
  assert.equal(result.saved, 2)
  assert.match(result.items.find((i) => i.kind === 'team')?.reason ?? '', /保存できませんでした/)
})
