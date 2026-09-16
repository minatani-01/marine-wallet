import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SOURCE_PAGE_KINDS, snapshotSourcePages, sourcePageUrl } from '../pages'

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

test('ページのURLを組み立てる', () => {
  assert.equal(
    sourcePageUrl('milestone_batting', 2026),
    'https://npb.jp/history/2026/milestones_b.html'
  )
  assert.equal(
    sourcePageUrl('milestone_pitching', 2026),
    'https://npb.jp/history/2026/milestones_p.html'
  )
  assert.equal(
    sourcePageUrl('milestone_team', 2026),
    'https://npb.jp/history/2026/milestones_team.html'
  )
  // 記録のページは年で分かれる
  assert.equal(
    sourcePageUrl('milestone_batting', 2027),
    'https://npb.jp/history/2027/milestones_b.html'
  )
  // 名鑑は年で分かれない。常に今の登録選手が出る
  assert.equal(sourcePageUrl('roster', 2026), 'https://npb.jp/bis/teams/rst_m.html')
  assert.equal(sourcePageUrl('roster', 2027), 'https://npb.jp/bis/teams/rst_m.html')
})

test('4ページとも取って保存する', async () => {
  const { supabase, saved } = fakeSupabase()
  const urls: string[] = []

  const result = await snapshotSourcePages(supabase as never, 2026, async (url) => {
    urls.push(url)
    return '<html>記録</html>'
  })

  assert.equal(result.saved, 4)
  assert.equal(urls.length, 4)
  assert.deepEqual(saved.map((r) => r.kind), [...SOURCE_PAGE_KINDS])
  assert.equal(saved[0].season, 2026)
})

test('空の中身は保存しない（記録なしと誤解される）', async () => {
  const { supabase, saved } = fakeSupabase()
  const result = await snapshotSourcePages(supabase as never, 2026, async () => '   ')
  assert.equal(result.saved, 0)
  assert.equal(saved.length, 0)
  assert.match(result.items[0].reason ?? '', /空/)
})

test('1ページ落ちても、残りは取りに行く', async () => {
  const { supabase, saved } = fakeSupabase()
  const result = await snapshotSourcePages(supabase as never, 2026, async (url) => {
    if (url.includes('milestones_p')) throw new Error('接続できません')
    return '<html>記録</html>'
  })

  assert.equal(result.saved, 3)
  assert.deepEqual(saved.map((r) => r.kind), ['milestone_batting', 'milestone_team', 'roster'])
  const failed = result.items.find((i) => i.kind === 'milestone_pitching')
  assert.equal(failed?.status, 'failed')
  assert.match(failed?.reason ?? '', /取得できませんでした/)
})

test('保存に失敗したページは saved に数えない', async () => {
  const { supabase } = fakeSupabase(['milestone_team'])
  const result = await snapshotSourcePages(supabase as never, 2026, async () => '<html>記録</html>')
  assert.equal(result.saved, 3)
  assert.match(
    result.items.find((i) => i.kind === 'milestone_team')?.reason ?? '',
    /保存できませんでした/
  )
})
