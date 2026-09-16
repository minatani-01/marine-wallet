import { test } from 'node:test'
import assert from 'node:assert/strict'

import { BACKFILL_LIMIT, backfillGames } from '../backfill'

/**
 * Supabase の代わり。呼ばれた順に決められた結果を返し、
 * 何を書こうとしたかを覚えておく。
 *
 * ここで確かめたいのは取り込みの段取り（古い順・上限・見送りの判断）で、
 * Supabase の挙動そのものではない。
 */
function fakeSupabase(npbRows: unknown[], registered: string[]) {
  const inserted: Record<string, unknown>[] = []
  const updated: Record<string, unknown>[] = []

  const thenable = <T>(value: T) => {
    const chain: Record<string, unknown> = {}
    for (const key of ['select', 'eq', 'order', 'update', 'insert']) {
      chain[key] = () => chain
    }
    chain.then = (resolve: (v: T) => unknown) => Promise.resolve(value).then(resolve)
    return chain
  }

  const supabase = {
    from(table: string) {
      if (table === 'games') {
        return {
          select: () => thenable({ data: registered.map((d) => ({ game_date: d })), error: null }),
          insert: (row: Record<string, unknown>) => {
            inserted.push(row)
            return thenable({ error: null })
          },
        }
      }
      // npb_games
      return {
        select: () => thenable({ data: npbRows, error: null }),
        update: (row: Record<string, unknown>) => {
          updated.push(row)
          return thenable({ error: null })
        },
      }
    },
  }
  return { supabase, inserted, updated }
}

const row = (date: string, over: Record<string, unknown> = {}) => ({
  game_date: date,
  home_team: '日本ハム',
  away_team: 'ロッテ',
  home_score: 6,
  away_score: 7,
  place: 'エスコンＦ',
  phase: 'regular',
  status: 'finished',
  save_pitcher: '',
  box_score_path: `/scores/2026/x/${date}/`,
  raw: {},
  ...over,
})

/** 実物と同じ形の、最小のボックススコア HTML */
const boxHtml = (date: string, homeRuns = '山口 29号（6回2ラン 田中）') => {
  // 実物は「2026年9月4日（金）」と書く。パーサーはこの形から日付を読む
  const [y, m, d] = date.split('-').map(Number)
  return `
<div id="game_stats">
  <div class="game_tit">
    <time>${y}年${m}月${d}日（金）</time>
    <span class="place">エスコンＦ</span>
    <h3>【パーソル パ・リーグ公式戦】</h3>
  </div>
  <p class="game_info">【試合終了】</p>
  <table class="game_result_info">
    <tr><th>【勝投手】</th><td>中森（5勝2敗）</td></tr>
    <tr><th>【敗投手】</th><td>柳川（1勝3敗）</td></tr>
    <tr><th>【セーブ】</th><td>横山（31セ）</td></tr>
  </table>
  <h4>本塁打</h4>
  <table><tbody>
    <tr><th>【ロッテ】</th><td>${homeRuns}</td></tr>
  </tbody></table>
</div>`
}

test('未登録の試合だけを、古い順に取り込む', async () => {
  const { supabase, inserted } = fakeSupabase(
    [row('2026-09-04'), row('2026-09-05'), row('2026-09-06')],
    ['2026-09-05'] // 真ん中だけ登録済み
  )

  const result = await backfillGames(
    supabase as never,
    async (url) => boxHtml(url.includes('09-04') ? '2026-09-04' : '2026-09-06')
  )

  assert.equal(result.created, 2)
  assert.equal(result.remaining, 0)
  assert.deepEqual(
    inserted.map((g) => g.game_date),
    ['2026-09-04', '2026-09-06']
  )
})

test('登録済みの試合には触らない', async () => {
  const { supabase, inserted } = fakeSupabase([row('2026-09-04')], ['2026-09-04'])
  const result = await backfillGames(supabase as never, async () => boxHtml('2026-09-04'))
  assert.equal(result.created, 0)
  assert.equal(result.items.length, 0)
  assert.equal(inserted.length, 0)
})

test('1回で扱う数に上限がある。残りは remaining で分かる', async () => {
  const dates = Array.from({ length: BACKFILL_LIMIT + 3 }, (_, i) =>
    `2026-08-${String(i + 1).padStart(2, '0')}`
  )
  const { supabase, inserted } = fakeSupabase(dates.map((d) => row(d)), [])

  const result = await backfillGames(supabase as never, async (url) => {
    const date = url.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '2026-08-01'
    return boxHtml(date)
  })

  assert.equal(inserted.length, BACKFILL_LIMIT)
  assert.equal(result.created, BACKFILL_LIMIT)
  assert.equal(result.remaining, 3)
})

test('ボックススコアの日付が違えば入れない（別の試合を入れてしまう）', async () => {
  const { supabase, inserted } = fakeSupabase([row('2026-09-04')], [])
  const result = await backfillGames(supabase as never, async () => boxHtml('2026-09-09'))
  assert.equal(result.created, 0)
  assert.equal(inserted.length, 0)
  assert.match(result.items[0].reason ?? '', /日付が違います/)
})

test('取得に失敗した試合は見送り、他の試合は続ける', async () => {
  const { supabase, inserted } = fakeSupabase([row('2026-09-04'), row('2026-09-06')], [])
  const result = await backfillGames(supabase as never, async (url) => {
    if (url.includes('09-04')) throw new Error('接続できません')
    return boxHtml('2026-09-06')
  })
  assert.equal(result.created, 1)
  assert.equal(result.skipped, 1)
  assert.deepEqual(inserted.map((g) => g.game_date), ['2026-09-06'])
  assert.match(result.items[0].reason ?? '', /取得できませんでした/)
})

test('ボックススコアの場所が無い試合は取りに行かない', async () => {
  const { supabase } = fakeSupabase([row('2026-09-04', { box_score_path: '' })], [])
  let fetched = 0
  const result = await backfillGames(supabase as never, async () => {
    fetched += 1
    return boxHtml('2026-09-04')
  })
  assert.equal(fetched, 0)
  assert.equal(result.created, 0)
  assert.match(result.items[0].reason ?? '', /場所が分かりません/)
})

test('取り込んだ試合には本塁打とセーブが入る', async () => {
  const { supabase, inserted } = fakeSupabase([row('2026-09-04')], [])
  await backfillGames(supabase as never, async () =>
    boxHtml('2026-09-04', '山口 29号（6回2ラン 田中）、ソト 10号（7回満塁 宮西）')
  )
  const game = inserted[0]
  assert.equal(game.home_runs, 1)
  assert.equal(game.grand_slams, 1)
  // 7-6 でロッテの勝ち。セーブ投手が居るので付く
  assert.equal(game.result, 'win')
  assert.equal(game.has_save, true)
  assert.equal(game.source, 'npb')
})
