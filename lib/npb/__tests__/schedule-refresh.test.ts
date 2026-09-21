import { test } from 'node:test'
import assert from 'node:assert/strict'

import { changed, refreshSchedule } from '../schedule-refresh'

/**
 * Supabase の代わり。npb_games を読ませ、書こうとした内容を覚えておく。
 *
 * ここで確かめたいのは「変わった試合だけを直すか」で、
 * Supabase の挙動そのものではない。
 */
function fakeSupabase(npb: Record<string, unknown>[]) {
  const updates: { where: Record<string, string>; patch: Record<string, unknown> }[] = []
  const inserts: Record<string, unknown>[][] = []
  const leagueUpserts: Record<string, unknown>[][] = []

  const supabase = {
    from(table: string) {
      if (table === 'npb_league_games') {
        return {
          upsert: (rows: Record<string, unknown>[]) => {
            leagueUpserts.push(rows)
            return Promise.resolve({ error: null })
          },
        }
      }
      return {
        select: () => ({ in: () => Promise.resolve({ data: npb, error: null }) }),
        update: (patch: Record<string, unknown>) => {
          const where: Record<string, string> = {}
          const chain = {
            eq: (column: string, value: string) => {
              where[column] = value
              return Object.keys(where).length === 3
                ? (updates.push({ where, patch }), Promise.resolve({ error: null }))
                : chain
            },
          }
          return chain
        },
        insert: (rows: Record<string, unknown>[]) => {
          inserts.push(rows)
          return Promise.resolve({ error: null })
        },
      }
    },
  }

  return { supabase, updates, inserts, leagueUpserts }
}

/** 9/20 が中止、9/21 は予定。ロッテ以外の試合も1つ混ぜる */
const SCHEDULE = `
  <tr id="date0920">
    <td><div class="team1">ロッテ</div></td>
    <td><div class="score1">中止</div></td>
    <td><div class="score2">中止</div></td>
    <td><div class="team2">西武</div></td>
    <td><div class="place">ZOZOマリン</div></td>
    <td><div class="time">18:00</div></td>
  </tr>
  <tr id="date0921">
    <td><div class="team1">ロッテ</div></td>
    <td><div class="score1">&nbsp;</div></td>
    <td><div class="score2">&nbsp;</div></td>
    <td><div class="team2">西武</div></td>
    <td><div class="place">ZOZOマリン</div></td>
    <td><div class="time">18:00</div></td>
  </tr>
  <tr id="date0921">
    <td><div class="team1">ソフトバンク</div></td>
    <td><div class="score1">&nbsp;</div></td>
    <td><div class="score2">&nbsp;</div></td>
    <td><div class="team2">オリックス</div></td>
    <td><div class="place">みずほPayPay</div></td>
    <td><div class="time">18:00</div></td>
  </tr>`

const existing = (over: Record<string, unknown> = {}) => ({
  game_date: '2026-09-20',
  home_team: 'ロッテ',
  away_team: '西武',
  home_score: null,
  away_score: null,
  status: 'scheduled',
  note: '',
  start_time: '18:00',
  place: 'ZOZOマリン',
  box_score_path: '',
  ...over,
})

test('中止になった試合だけを直す', async () => {
  const { supabase, updates, inserts } = fakeSupabase([
    existing(),
    existing({ game_date: '2026-09-21' }),
  ])

  const result = await refreshSchedule(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase as any,
    new Date('2026-09-21T03:00:00Z'),
    async () => SCHEDULE
  )

  // 9/20 だけが変わる。9/21 は中身が同じなので書かない
  assert.equal(updates.length, 1)
  assert.equal(updates[0].where.game_date, '2026-09-20')
  assert.equal(updates[0].patch.status, 'cancelled')
  assert.equal(updates[0].patch.note, '中止')
  assert.deepEqual(result.updated, [
    { game_date: '2026-09-20', status: 'cancelled', note: '中止' },
  ])
  // すでにある試合を二重に入れない
  assert.equal(inserts.length, 0)
})

test('まだ無い試合は追加する', async () => {
  const { supabase, inserts } = fakeSupabase([])
  const result = await refreshSchedule(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase as any,
    new Date('2026-09-21T03:00:00Z'),
    async () => SCHEDULE
  )
  // ロッテの2試合だけ。他球団同士は npb_games に入れない
  assert.equal(result.added, 2)
  assert.equal(inserts[0].length, 2)
})

test('12球団ぶんは他球団同士も入れる', async () => {
  const { supabase, leagueUpserts } = fakeSupabase([])
  await refreshSchedule(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase as any,
    new Date('2026-09-21T03:00:00Z'),
    async () => SCHEDULE
  )
  const teams = leagueUpserts[0].map((row) => `${row.home_team}-${row.away_team}`)
  assert.equal(teams.includes('ソフトバンク-オリックス'), true)
})

test('変わったかどうかの判定', () => {
  const before = {
    home_score: null,
    away_score: null,
    status: 'scheduled',
    note: '',
    start_time: '18:00',
    place: 'ZOZOマリン',
    box_score_path: '',
  }
  assert.equal(changed(before, { ...before }), false)
  assert.equal(changed(before, { ...before, status: 'cancelled' }), true)
  assert.equal(changed(before, { ...before, start_time: '17:00' }), true)
})

test('シーズンの残りの月', async () => {
  const { remainingMonths } = await import('../schedule-refresh')
  // 9月なら 9〜11月（ポストシーズンまで）
  assert.deepEqual(
    remainingMonths(2026, 9).map((m) => m.month),
    [9, 10, 11]
  )
  // 開幕前は3月から
  assert.deepEqual(
    remainingMonths(2026, 1).map((m) => m.month),
    [3, 4, 5, 6, 7, 8, 9, 10, 11]
  )
  // シーズンが終わっていれば何も取りに行かない
  assert.deepEqual(remainingMonths(2026, 12), [])
})
