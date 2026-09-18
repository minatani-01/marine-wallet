import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildStampCard, scoreOf, visitFromGame, visitOfGame } from '../stadium-stamp'
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
    marines_score: 5,
    opponent_score: 1,
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
  const g = game({ stadium: 'ZOZOマリン' })
  const card = buildStampCard([], [g])

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

test('券面には初めて行った試合の日付と点数が載る', () => {
  const first = game({ id: 'g1', game_date: '2026-03-27', marines_score: 5, opponent_score: 1 })
  const second = game({ id: 'g2', game_date: '2026-05-10', marines_score: 0, opponent_score: 3 })

  const card = buildStampCard(
    [
      visit({ stadium_id: 'zozo', visited_on: '2026-05-10', game_id: 'g2' }),
      visit({ stadium_id: 'zozo', visited_on: '2026-03-27', game_id: 'g1' }),
    ],
    [first, second]
  )
  const zozo = card.home.find((s) => s.stadium.id === 'zozo')!

  assert.equal(zozo.log[0].date, '2026-03-27')
  assert.equal(zozo.log[0].score, '5-1')
  // 2回目以降も履歴としては残る
  assert.equal(zozo.log[1].score, '0-3')
})

test('試合を渡さなくてもスタンプは付く（日付だけになる）', () => {
  const card = buildStampCard([visit({ stadium_id: 'zozo', game_id: 'g1' })])
  const zozo = card.home.find((s) => s.stadium.id === 'zozo')!

  assert.equal(zozo.visited, true)
  assert.equal(zozo.log[0].game, null)
  assert.equal(zozo.log[0].score, null)
})

test('点数の無い試合は点数を出さない', () => {
  assert.equal(scoreOf(game({ marines_score: null })), null)
  assert.equal(scoreOf(game({ opponent_score: null })), null)
  assert.equal(scoreOf(null), null)
  // 0-0 は「点数が無い」ではない
  assert.equal(scoreOf(game({ marines_score: 0, opponent_score: 0 })), '0-0')
})

test('本拠地12球団と地方球場を分けて数え、通し番号を振る', () => {
  const card = buildStampCard([visit({ stadium_id: 'zozo' }), visit({ stadium_id: 'omiya' })])

  assert.equal(card.home.length, 12)
  assert.equal(card.homeVisited, 1)
  assert.equal(card.regionalVisited, 1)
  assert.deepEqual(
    card.home.map((s) => s.no),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  )
})

test('その試合を現地観戦したかどうかを引ける', () => {
  const v = visit({ game_id: 'g1', stadium_id: 'zozo' })

  assert.equal(visitOfGame('g1', [v])?.id, v.id)
  assert.equal(visitOfGame('g2', [v]), null)
})

test('試合から訪問記録の中身を作る', () => {
  assert.deepEqual(visitFromGame(game({ stadium: 'エスコンＦ', game_date: '2026-09-15' })), {
    stadium_id: 'escon',
    visited_on: '2026-09-15',
  })
  // 球場を引けない試合にはスタンプの付け先が無い
  assert.equal(visitFromGame(game({ stadium: 'どこかの球場' })), null)
})
