import { test } from 'node:test'
import assert from 'node:assert/strict'

import { marinesHomeRunsOf, repairGames } from '../repair'

/**
 * Supabase の代わり。games と npb_games を読ませ、
 * games へ書こうとした内容を覚えておく。
 *
 * ここで確かめたいのは「何を直して、何を直さないか」で、
 * Supabase の挙動そのものではない。
 */
function fakeSupabase(games: Record<string, unknown>[], npb: Record<string, unknown>[]) {
  const patches: { id: string; patch: Record<string, unknown> }[] = []

  const thenable = <T>(value: T) => {
    const chain: Record<string, unknown> = {}
    for (const key of ['select', 'eq', 'gte', 'lte', 'order']) chain[key] = () => chain
    chain.then = (resolve: (v: T) => unknown) => Promise.resolve(value).then(resolve)
    return chain
  }

  const supabase = {
    from(table: string) {
      if (table === 'games') {
        return {
          select: () => thenable({ data: games, error: null }),
          update: (patch: Record<string, unknown>) => ({
            eq: (_column: string, id: string) => {
              patches.push({ id, patch })
              return Promise.resolve({ error: null })
            },
          }),
        }
      }
      return { select: () => thenable({ data: npb, error: null }) }
    },
  }

  return { supabase, patches }
}

const npbRow = (over: Record<string, unknown> = {}) => ({
  game_date: '2026-04-10',
  home_team: '西武',
  away_team: 'ロッテ',
  home_score: 2,
  away_score: 5,
  place: 'ベルーナドーム',
  phase: 'regular',
  status: 'finished',
  save_pitcher: '',
  ...over,
})

const gameRow = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  game_date: '2026-04-10',
  opponent: 'lions',
  home_away: null,
  stadium: '',
  marines_score: null,
  opponent_score: null,
  result: 'win',
  home_runs: 0,
  grand_slams: 0,
  has_save: false,
  ...over,
})

/** ボックススコアを取っている取得データ */
const withBox = (homeRuns: Record<string, string>[]) => ({
  raw: { box: { homeRuns } },
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (games: Record<string, unknown>[], npb: Record<string, unknown>[]) => {
  const { supabase, patches } = fakeSupabase(games, npb)
  return repairGames(supabase as never, 2026).then((result) => ({ result, patches }))
}

test('入っていないホーム・ビジターと得点を埋める', async () => {
  const { result, patches } = await run([gameRow()], [npbRow()])

  assert.equal(result.updated, 1)
  assert.deepEqual(patches[0].patch, {
    home_away: 'away',
    stadium: 'ベルーナドーム',
    marines_score: 5,
    opponent_score: 2,
  })
})

test('すでに正しい試合には触らない', async () => {
  const done = gameRow({
    home_away: 'away',
    stadium: 'ベルーナドーム',
    marines_score: 5,
    opponent_score: 2,
  })
  const { result, patches } = await run([done], [npbRow()])

  assert.equal(result.updated, 0)
  assert.equal(patches.length, 0)
})

test('勝敗が食い違っても書き換えず、知らせるだけにする', async () => {
  // 取得データは 5-2 でマリーンズの勝ち。登録は負けになっている
  const wrong = gameRow({
    result: 'lose',
    home_away: 'away',
    stadium: 'ベルーナドーム',
    marines_score: 5,
    opponent_score: 2,
  })
  const { result, patches } = await run([wrong], [npbRow()])

  assert.equal(patches.length, 0)
  assert.deepEqual(result.mismatches, [
    { game_date: '2026-04-10', field: 'result', current: 'lose', npb: 'win' },
  ])
})

test('フェーズは比べない（日程表から取れないので regular で入る）', async () => {
  // 交流戦として登録してある試合。取得データは regular だが直さない
  const interleague = gameRow({
    home_away: 'away',
    stadium: 'ベルーナドーム',
    marines_score: 5,
    opponent_score: 2,
  })
  const { patches } = await run([interleague], [npbRow({ phase: 'regular' })])

  assert.equal(patches.length, 0)
})

test('同じ日に2試合あるときは直さない（取り違えると別の試合を書く）', async () => {
  const a = gameRow({ id: 'g1', opponent: 'hawks' })
  const b = gameRow({ id: 'g2', opponent: 'buffaloes' })
  const { result, patches } = await run([a, b], [npbRow()])

  assert.equal(patches.length, 0)
  assert.equal(result.skipped.length, 2)
  assert.equal(result.skipped[0].reason, '同じ日に複数の試合があります')
})

test('取得データが無い試合は見送る', async () => {
  const { result, patches } = await run([gameRow({ game_date: '2026-03-27' })], [npbRow()])

  assert.equal(patches.length, 0)
  assert.deepEqual(result.skipped, [{ game_date: '2026-03-27', reason: '取得データがありません' }])
})

test('中止など得点の入っていない試合は見送る', async () => {
  const { result, patches } = await run(
    [gameRow()],
    [npbRow({ home_score: null, away_score: null })]
  )

  assert.equal(patches.length, 0)
  assert.equal(result.skipped[0].reason, '得点が入っていません（中止や延期の可能性）')
})

test('対戦相手が違っていれば直す（金額には関わらない）', async () => {
  const wrong = gameRow({
    opponent: 'hawks',
    home_away: 'away',
    stadium: 'ベルーナドーム',
    marines_score: 5,
    opponent_score: 2,
  })
  const { patches } = await run([wrong], [npbRow()])

  assert.deepEqual(patches[0].patch, { opponent: 'lions' })
})

test('取得データの本塁打欄から自軍の本数を数える', () => {
  const counted = marinesHomeRunsOf({
    box: {
      homeRuns: [
        { team: 'ロッテ', batter: '山口', detail: '山口 29号（6回2ラン 田中）' },
        { team: 'ロッテ', batter: 'ソト', detail: 'ソト 10号（8回満塁 柳川）' },
        { team: '西武', batter: '外崎', detail: '外崎 5号（3回ソロ 種市）' },
      ],
    },
  })

  // 満塁は別枠。相手の本塁打は数えない
  assert.deepEqual(counted, { home_runs: 1, grand_slams: 1 })
})

test('ボックススコアを取っていなければ数えない', () => {
  assert.equal(marinesHomeRunsOf({ schedule: {} }), null)
  assert.equal(marinesHomeRunsOf(null), null)
})

test('本塁打が食い違っても書き換えず、知らせるだけにする', async () => {
  const done = gameRow({
    home_away: 'away',
    stadium: 'ベルーナドーム',
    marines_score: 5,
    opponent_score: 2,
    home_runs: 0,
  })
  const npb = npbRow(
    withBox([{ team: 'ロッテ', batter: '山口', detail: '山口 29号（6回2ラン 田中）' }])
  )
  const { result, patches } = await run([done], [npb])

  assert.equal(patches.length, 0)
  assert.deepEqual(result.mismatches, [
    { game_date: '2026-04-10', field: 'home_runs', current: '0', npb: '1' },
  ])
})

test('ボックススコアが無ければ本塁打は比べない', async () => {
  const done = gameRow({
    home_away: 'away',
    stadium: 'ベルーナドーム',
    marines_score: 5,
    opponent_score: 2,
    home_runs: 3,
  })
  const { result } = await run([done], [npbRow()])

  assert.deepEqual(result.mismatches, [])
})

test('勝った試合にセーブ投手が居ればセーブありとして比べる', async () => {
  const done = gameRow({
    home_away: 'away',
    stadium: 'ベルーナドーム',
    marines_score: 5,
    opponent_score: 2,
    has_save: false,
  })
  const npb = npbRow({ save_pitcher: '横山', ...withBox([]) })
  const { result, patches } = await run([done], [npb])

  assert.equal(patches.length, 0)
  assert.deepEqual(result.mismatches, [
    { game_date: '2026-04-10', field: 'has_save', current: 'なし', npb: 'あり' },
  ])
})
