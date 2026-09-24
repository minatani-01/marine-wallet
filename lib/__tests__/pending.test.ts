import { test } from 'node:test'
import assert from 'node:assert/strict'

import { pendingSeries } from '../npb/pending'
import type { SeasonGame } from '../../types'

const PACIFIC = ['西武', 'オリックス', 'ソフトバンク', '日本ハム', '楽天']
const CENTRAL = ['阪神', '巨人', 'DeNA', '広島', 'ヤクルト', '中日']

/**
 * 相手ごとに games 試合ぶんの行を作る。cancelled のぶんは日付が決まって
 * いない扱いになる（中止の行は数に入らない）
 */
function season(counts: Record<string, number>, cancelled: Record<string, number> = {}) {
  const rows: SeasonGame[] = []
  let day = 1
  const push = (opponent: string, status: string) => {
    day += 1
    rows.push({
      game_date: `2026-04-${String((day % 28) + 1).padStart(2, '0')}`,
      home_team: 'ロッテ',
      away_team: opponent,
      status,
    })
  }
  for (const [opponent, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i += 1) push(opponent, 'finished')
    for (let i = 0; i < (cancelled[opponent] ?? 0); i += 1) push(opponent, 'cancelled')
  }
  return rows
}

const full = () => {
  const counts: Record<string, number> = {}
  for (const team of PACIFIC) counts[team] = 25
  for (const team of CENTRAL) counts[team] = 3
  return counts
}

test('どの相手も揃っていれば何も出さない', () => {
  assert.deepEqual(pendingSeries(season(full()), 'ロッテ'), [])
})

test('ほかの相手より少ない相手の差を出す', () => {
  const counts = full()
  counts['西武'] = 23
  const rows = pendingSeries(season(counts, { 西武: 2 }), 'ロッテ')
  assert.deepEqual(rows, [{ opponent: '西武', games: 2 }])
})

test('交流戦は同じリーグと分けて比べる', () => {
  const counts = full()
  counts['阪神'] = 2
  assert.deepEqual(pendingSeries(season(counts), 'ロッテ'), [{ opponent: '阪神', games: 1 }])
})

test('1つだけ多い相手には引きずられない', () => {
  const counts = full()
  counts['楽天'] = 26
  assert.deepEqual(pendingSeries(season(counts), 'ロッテ'), [])
})

test('日程がまだ入りきっていない時期は何も出さない', () => {
  const counts: Record<string, number> = {}
  for (const team of PACIFIC) counts[team] = 6
  assert.deepEqual(pendingSeries(season(counts), 'ロッテ'), [])
})

test('多い相手から順に並べる', () => {
  const counts = full()
  counts['西武'] = 24
  counts['楽天'] = 23
  assert.deepEqual(pendingSeries(season(counts), 'ロッテ'), [
    { opponent: '楽天', games: 2 },
    { opponent: '西武', games: 1 },
  ])
})

test('球団名でない行は数えない', () => {
  const rows = season(full())
  rows.push({
    game_date: '2026-07-22',
    home_team: 'パ・リーグ',
    away_team: 'セ・リーグ',
    status: 'finished',
  })
  assert.deepEqual(pendingSeries(rows, 'ロッテ'), [])
})
