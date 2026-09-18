import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildStampCard, uncheckedGames, visitFromGame } from '../stadium-stamp'
import type { Game, StadiumVisit } from '../../types'

const visit = (over: Partial<StadiumVisit> = {}): StadiumVisit => ({
  id: crypto.randomUUID(),
  user_id: 'u1',
  stadium_id: 'zozo',
  visited_on: '2026-04-03',
  game_id: null,
  note: '',
  ...over,
})

const game = (over: Partial<Game> = {}): Game =>
  ({
    id: crypto.randomUUID(),
    game_date: '2026-09-15',
    opponent: 'fighters',
    stadium: 'エスコンＦ',
    result: 'win',
    phase: 'regular',
    home_away: 'away',
    ...over,
  }) as Game

test('行った球場だけにスタンプが付く', () => {
  const card = buildStampCard([visit({ stadium_id: 'zozo' })])

  assert.equal(card.homeVisited, 1)
  assert.equal(card.home.find((s) => s.stadium.id === 'zozo')?.visited, true)
  assert.equal(card.home.find((s) => s.stadium.id === 'koshien')?.visited, false)
})

test('訪問記録が無ければ、試合があってもスタンプは付かない', () => {
  // 試合データは126件あるが、行ったかどうかは本人しか知らない
  const card = buildStampCard([])

  assert.equal(card.homeVisited, 0)
  assert.equal(card.regionalVisited, 0)
  assert.equal(card.home.every((s) => !s.visited), true)
})

test('初めて行った日と回数を数える', () => {
  const card = buildStampCard([
    visit({ stadium_id: 'zozo', visited_on: '2026-05-10', game_id: 'g2' }),
    visit({ stadium_id: 'zozo', visited_on: '2026-03-27', game_id: 'g1' }),
    visit({ stadium_id: 'zozo', visited_on: '2026-07-01' }),
  ])
  const zozo = card.home.find((s) => s.stadium.id === 'zozo')!

  assert.equal(zozo.firstVisit, '2026-03-27')
  assert.equal(zozo.visits, 3)
  // 試合に紐づかない来場（イベント・見学）は観戦に数えない
  assert.equal(zozo.games, 2)
})

test('本拠地12球団と地方球場を分けて数える', () => {
  const card = buildStampCard([
    visit({ stadium_id: 'zozo' }),
    visit({ stadium_id: 'omiya' }),
  ])

  assert.equal(card.home.length, 12)
  assert.equal(card.homeVisited, 1)
  assert.equal(card.regionalVisited, 1)
})

test('まだ押していない試合を新しい順に出す', () => {
  const a = game({ game_date: '2026-09-15' })
  const b = game({ game_date: '2026-09-16' })
  const c = game({ game_date: '2026-09-14' })

  const list = uncheckedGames([a, b, c], [visit({ game_id: a.id })])

  assert.deepEqual(
    list.map((g) => g.game_date),
    ['2026-09-16', '2026-09-14']
  )
})

test('球場を引けない試合は候補に出さない（スタンプの付け先がない）', () => {
  const unknown = game({ stadium: 'どこかの球場' })
  assert.deepEqual(uncheckedGames([unknown], []), [])
})

test('試合から訪問記録の中身を作る', () => {
  assert.deepEqual(visitFromGame(game({ stadium: 'エスコンＦ', game_date: '2026-09-15' })), {
    stadium_id: 'escon',
    visited_on: '2026-09-15',
  })
  assert.equal(visitFromGame(game({ stadium: 'どこかの球場' })), null)
})
