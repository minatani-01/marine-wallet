import { test } from 'node:test'
import assert from 'node:assert/strict'

import { upcomingOf } from '../upcoming'
import type { ScheduledGame } from '../../types'

const row = (over: Partial<ScheduledGame> = {}): ScheduledGame => ({
  game_date: '2026-09-22',
  home_team: 'ロッテ',
  away_team: '西武',
  place: 'ZOZOマリン',
  start_time: '18:00',
  status: 'scheduled',
  note: '',
  ...over,
})

test('相手とホーム・ビジターを読み替える', () => {
  const [home] = upcomingOf([row()])
  assert.deepEqual(
    { opponent: home.opponent, isHome: home.isHome, startTime: home.startTime },
    { opponent: '西武', isHome: true, startTime: '18:00' }
  )

  const [away] = upcomingOf([row({ home_team: '楽天', away_team: 'ロッテ', place: '楽天モバイル' })])
  assert.equal(away.opponent, '楽天')
  assert.equal(away.isHome, false)
})

test('中止は消さずに印を付ける', () => {
  const [game] = upcomingOf([row({ status: 'cancelled', note: '雨天中止　小雨' })])
  assert.equal(game.cancelled, true)
  assert.equal(game.note, '雨天中止')
  // 時刻は出さない。中止になった試合の開始時刻に意味は無い
  assert.equal(game.startTime, '')
})

test('理由が書かれていない中止でも印は出す', () => {
  const [game] = upcomingOf([row({ status: 'cancelled', note: '' })])
  assert.equal(game.note, '中止')
})

test('マリーンズ以外の試合は出さない', () => {
  const rows = [row({ home_team: 'ソフトバンク', away_team: 'オリックス' }), row()]
  const list = upcomingOf(rows)
  assert.equal(list.length, 1)
  assert.equal(list[0].opponent, '西武')
})

test('出す数を絞る', () => {
  const rows = Array.from({ length: 8 }, (_, i) =>
    row({ game_date: `2026-09-${String(22 + i).padStart(2, '0')}` })
  )
  assert.equal(upcomingOf(rows).length, 5)
  assert.equal(upcomingOf(rows, 3).length, 3)
})

test('その月の中止だけを新しい順に取り出す', async () => {
  const { cancelledOf } = await import('../upcoming')
  const rows = [
    row({ game_date: '2026-09-03', status: 'cancelled', note: '雨天中止' }),
    row({ game_date: '2026-09-18', status: 'cancelled', note: '雨天中止' }),
    row({ game_date: '2026-09-19' }),
    row({ game_date: '2026-08-30', status: 'cancelled', note: '雨天中止' }),
  ]
  assert.deepEqual(
    cancelledOf(rows, '2026-09').map((g) => g.date),
    ['2026-09-18', '2026-09-03']
  )
})

test('記録と中止を日付順に混ぜる', async () => {
  const { cancelledOf, mergeCancelled } = await import('../upcoming')
  const entries = [{ entry_date: '2026-09-19' }, { entry_date: '2026-09-02' }]
  const cancelled = cancelledOf(
    [row({ game_date: '2026-09-18', status: 'cancelled', note: '雨天中止' })],
    '2026-09'
  )

  assert.deepEqual(
    mergeCancelled(entries, cancelled).map((r) => `${r.date}:${r.kind}`),
    ['2026-09-19:entry', '2026-09-18:cancelled', '2026-09-02:entry']
  )
})

test('同じ日は記録を先に置く', async () => {
  const { cancelledOf, mergeCancelled } = await import('../upcoming')
  const cancelled = cancelledOf(
    [row({ game_date: '2026-09-18', status: 'cancelled', note: '雨天中止' })],
    '2026-09'
  )
  assert.deepEqual(
    mergeCancelled([{ entry_date: '2026-09-18' }], cancelled).map((r) => r.kind),
    ['entry', 'cancelled']
  )
})
