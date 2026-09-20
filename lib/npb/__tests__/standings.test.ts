import { test } from 'node:test'
import assert from 'node:assert/strict'

import { countable, leagueOf, standingsOf, type LeagueGame } from '../standings'

const game = (over: Partial<LeagueGame> = {}): LeagueGame => ({
  game_date: '2026-09-01',
  home_team: 'ロッテ',
  away_team: '西武',
  home_score: 3,
  away_score: 1,
  status: 'finished',
  note: '',
  ...over,
})

test('リーグの見分け', () => {
  assert.equal(leagueOf('ロッテ'), 'p')
  assert.equal(leagueOf('阪神'), 'c')
  // 二軍やオールスターの表記は数えない
  assert.equal(leagueOf('全パ'), null)
})

test('数える試合の条件', () => {
  assert.equal(countable(game()), true)
  // 未実施・中止は数えない
  assert.equal(countable(game({ status: 'scheduled' })), false)
  assert.equal(countable(game({ status: 'cancelled', home_score: null, away_score: null })), false)
  // 得点が入っていないものも数えない
  assert.equal(countable(game({ home_score: null })), false)
  // ポストシーズンは順位に入れない
  assert.equal(countable(game({ note: 'クライマックスシリーズ ファーストステージ' })), false)
  assert.equal(countable(game({ note: '日本シリーズ 第1戦' })), false)
})

test('勝敗と勝率を数える', () => {
  const rows = standingsOf(
    [
      game({ home_team: 'ロッテ', away_team: '西武', home_score: 3, away_score: 1 }),
      game({ home_team: '西武', away_team: 'ロッテ', home_score: 2, away_score: 5 }),
      // 引き分けは勝率に入れない
      game({ home_team: 'ロッテ', away_team: '楽天', home_score: 2, away_score: 2 }),
      // 交流戦も数える
      game({ home_team: 'ロッテ', away_team: '阪神', home_score: 0, away_score: 4 }),
    ],
    'p'
  )

  const lotte = rows.find((r) => r.team === 'ロッテ')!
  assert.deepEqual(
    { win: lotte.win, lose: lotte.lose, draw: lotte.draw, rate: lotte.rate },
    { win: 2, lose: 1, draw: 1, rate: 0.667 }
  )
  assert.equal(lotte.rank, 1)
  assert.equal(lotte.games_behind, 0)
  assert.equal(lotte.as_of, '2026-09-01')

  // 6球団すべてが並ぶ。試合が無いチームは 0勝0敗で勝率なし
  assert.equal(rows.length, 6)
  const softbank = rows.find((r) => r.team === 'ソフトバンク')!
  assert.equal(softbank.rate, null)
})

test('順位とゲーム差', () => {
  const win = (home: string, away: string) =>
    game({ home_team: home, away_team: away, home_score: 1, away_score: 0 })

  // ロッテ 2勝0敗 / 西武 1勝1敗 / 楽天 0勝2敗
  const rows = standingsOf(
    [win('ロッテ', '西武'), win('ロッテ', '楽天'), win('西武', '楽天')],
    'p'
  )
  const by = (team: string) => rows.find((r) => r.team === team)!

  assert.equal(by('ロッテ').rank, 1)
  assert.equal(by('西武').rank, 2)
  assert.equal(by('西武').games_behind, 1)
  assert.equal(by('楽天').rank, 3)
  assert.equal(by('楽天').games_behind, 2)
  // まだ1試合もしていない3球団は最後に並ぶ（0.000 と同じには扱わない）
  assert.equal(by('ソフトバンク').rank, 4)
})

test('同率は同じ順位になる', () => {
  const rows = standingsOf(
    [
      game({ home_team: 'ロッテ', away_team: '西武', home_score: 1, away_score: 0 }),
      game({ home_team: 'オリックス', away_team: '楽天', home_score: 1, away_score: 0 }),
    ],
    'p'
  )
  assert.equal(rows.find((r) => r.team === 'ロッテ')!.rank, 1)
  assert.equal(rows.find((r) => r.team === 'オリックス')!.rank, 1)
  // 負けた2球団も同率
  assert.equal(rows.find((r) => r.team === '西武')!.rank, 3)
  assert.equal(rows.find((r) => r.team === '楽天')!.rank, 3)
  // まだ試合をしていない2球団はそのあと
  assert.equal(rows.find((r) => r.team === '日本ハム')!.rank, 5)
})

test('欠けている月があれば順位を出さない', async () => {
  const { missingMonths, monthsOf } = await import('../league')
  const want = monthsOf([{ game_date: '2026-03-27' }, { game_date: '2026-09-17' }])
  const have = monthsOf([{ game_date: '2026-09-01' }])
  assert.deepEqual(missingMonths(want, have), ['2026-03'])
  // すべて揃っていれば空
  assert.deepEqual(missingMonths(want, monthsOf([{ game_date: '2026-03-01' }, { game_date: '2026-09-01' }])), [])
})
