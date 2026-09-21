import { test } from 'node:test'
import assert from 'node:assert/strict'

import { inningsToOuts, outsToInnings, text, toInt } from '../html'
import { gamesOf, losePitcherOf, parseSchedule, winPitcherOf } from '../schedule'
import { parseBoxScore, phaseFromSeriesLabel } from '../boxscore'
import { parseTeamStats } from '../stats'
import {
  BATTING_HTML,
  BOX_SCORE_HTML,
  BOX_SCORE_INTERLEAGUE_HTML,
  BOX_SCORE_WITH_SAVE_HTML,
  PITCHING_HTML,
  SCHEDULE_HTML,
} from './fixtures'

// ---------------------------------------------------------------------------
// html.ts
// ---------------------------------------------------------------------------

test('text はタグと実体参照を落として空白をまとめる', () => {
  assert.equal(text('<div class="a">  勝：高野脩 \n </div>'), '勝：高野脩')
  assert.equal(text('&nbsp;'), '')
  assert.equal(text('A&amp;B'), 'A&B')
  assert.equal(text(null), '')
})

test('toInt は数字でないものを null にする', () => {
  assert.equal(toInt('12'), 12)
  assert.equal(toInt('1,234'), 1234)
  assert.equal(toInt(' '), null)
  assert.equal(toInt('.212'), null)
  assert.equal(toInt(null), null)
})

test('inningsToOuts は投球回の小数部を三進法として扱う', () => {
  // 15回1/3 = 46アウト。小数として足すと 15.1 になってしまう
  assert.equal(inningsToOuts('15.1'), 46)
  assert.equal(inningsToOuts('100.2'), 302)
  assert.equal(inningsToOuts('21'), 63)
  assert.equal(inningsToOuts(' 15.1 '), 46)
  // .3 以上は存在しない
  assert.equal(inningsToOuts('15.3'), null)
  assert.equal(inningsToOuts(''), null)
})

test('outsToInnings は表示用に戻せる', () => {
  assert.equal(outsToInnings(46), '15 1/3')
  assert.equal(outsToInnings(302), '100 2/3')
  assert.equal(outsToInnings(63), '21')
})

test('投球回はアウト数で差分を取れば正しく足せる', () => {
  // 6回1/3 と 2/3 を足すと ちょうど 7回
  assert.equal(outsToInnings(inningsToOuts('6.1')! + inningsToOuts('0.2')!), '7')
})

// ---------------------------------------------------------------------------
// schedule.ts
// ---------------------------------------------------------------------------

test('parseSchedule は rowspan で日付が省略された行も拾う', () => {
  const games = parseSchedule(SCHEDULE_HTML, 2026)
  assert.equal(games.length, 4)
  // 9/1 の2試合目は日付セルが無いが、tr の id から日付を取れている
  assert.equal(games[1].gameDate, '2026-09-01')
  assert.equal(games[1].homeTeam, 'ソフトバンク')
})

test('parseSchedule は team1 をホームとして扱う', () => {
  const [first] = parseSchedule(SCHEDULE_HTML, 2026)
  assert.equal(first.gameDate, '2026-09-01')
  assert.equal(first.homeTeam, 'ロッテ')
  assert.equal(first.awayTeam, '西武')
  assert.equal(first.homeScore, 1)
  assert.equal(first.awayScore, 0)
  assert.equal(first.place, 'ZOZOマリン')
  assert.equal(first.startTime, '18:00')
  assert.equal(first.boxScorePath, '/scores/2026/0901/m-l-20/')
  assert.equal(first.status, 'finished')
})

test('parseSchedule は責任投手を接頭辞ごと保持する', () => {
  const [first] = parseSchedule(SCHEDULE_HTML, 2026)
  assert.deepEqual(first.pitchers, ['勝：高野脩', '敗：平良'])
  assert.equal(winPitcherOf(first), '高野脩')
  assert.equal(losePitcherOf(first), '平良')
})

test('parseSchedule は未実施の試合を scheduled にしスコアを null にする', () => {
  const games = parseSchedule(SCHEDULE_HTML, 2026)
  const upcoming = games.find((g) => g.gameDate === '2026-09-16')!
  assert.equal(upcoming.status, 'scheduled')
  assert.equal(upcoming.homeScore, null)
  assert.equal(upcoming.awayScore, null)
  assert.equal(upcoming.boxScorePath, '')
  // 試合前は予告先発が入る
  assert.deepEqual(upcoming.pitchers, ['先発：種市'])
})

test('parseSchedule は天候アイコンの alt を note に拾う', () => {
  // 天候欄は文字ではなく天気アイコンで、情報は alt にしか無い（実データで確認）
  const games = parseSchedule(SCHEDULE_HTML, 2026)
  const upcoming = games.find((g) => g.gameDate === '2026-09-16')!
  assert.equal(upcoming.note, '雨時々止む')
})

test('parseSchedule は中止を cancelled にする', () => {
  const games = parseSchedule(SCHEDULE_HTML, 2026)
  const cancelled = games.find((g) => g.gameDate === '2026-09-17')!
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.note, '雨天中止')
})

test('parseSchedule は引き分けもスコアありとして finished にする', () => {
  const games = parseSchedule(SCHEDULE_HTML, 2026)
  const draw = games[1]
  assert.equal(draw.homeScore, 3)
  assert.equal(draw.awayScore, 3)
  assert.equal(draw.status, 'finished')
})

test('gamesOf はホームでもビジターでも拾う', () => {
  const games = parseSchedule(SCHEDULE_HTML, 2026)
  assert.equal(gamesOf(games, 'ロッテ').length, 3)
  assert.equal(gamesOf(games, '西武').length, 1)
  assert.equal(gamesOf(games, '巨人').length, 0)
})

// ---------------------------------------------------------------------------
// boxscore.ts
// ---------------------------------------------------------------------------

test('parseBoxScore は日付・球場・試合状態を取る', () => {
  const box = parseBoxScore(BOX_SCORE_HTML)
  assert.equal(box.gameDate, '2026-09-10')
  assert.equal(box.place, 'ZOZOマリン')
  assert.equal(box.state, '試合終了')
  assert.equal(box.isFinished, true)
})

test('parseBoxScore は責任投手から成績の括弧を落とす', () => {
  const box = parseBoxScore(BOX_SCORE_HTML)
  assert.equal(box.winPitcher, '高野脩')
  assert.equal(box.losePitcher, '岸')
  // セーブが付かない試合では行そのものが無い
  assert.equal(box.savePitcher, '')
})

test('parseBoxScore はセーブ投手を取る', () => {
  const box = parseBoxScore(BOX_SCORE_WITH_SAVE_HTML)
  assert.equal(box.savePitcher, '横山')
  assert.equal(box.winPitcher, '高野脩')
})

test('parseBoxScore は本塁打を球団ごとに取る', () => {
  const box = parseBoxScore(BOX_SCORE_HTML)
  assert.equal(box.homeRuns.length, 2)
  assert.deepEqual(
    box.homeRuns.map((h) => [h.team, h.batter]),
    [
      ['楽天', 'YG安田'],
      ['ロッテ', '佐藤'],
    ]
  )
  assert.match(box.homeRuns[1].detail, /17号/)
})

test('phaseFromSeriesLabel は見出しからフェーズを決める', () => {
  assert.equal(phaseFromSeriesLabel('パーソル パ・リーグ公式戦'), 'regular')
  assert.equal(phaseFromSeriesLabel('日本生命セ・パ交流戦'), 'interleague')
  assert.equal(phaseFromSeriesLabel('クライマックスシリーズ パ'), 'cs')
  assert.equal(phaseFromSeriesLabel('日本シリーズ'), 'nippon_series')
})

test('parseBoxScore は交流戦を interleague にする', () => {
  assert.equal(parseBoxScore(BOX_SCORE_INTERLEAGUE_HTML).phase, 'interleague')
  assert.equal(parseBoxScore(BOX_SCORE_HTML).phase, 'regular')
})

// ---------------------------------------------------------------------------
// stats.ts
// ---------------------------------------------------------------------------

test('parseTeamStats は基準日を取る（取得日ではない）', () => {
  assert.equal(parseTeamStats(BATTING_HTML, 'batting').asOf, '2026-09-13')
  assert.equal(parseTeamStats(PITCHING_HTML, 'pitching').asOf, '2026-09-13')
})

test('parseTeamStats は打撃の列を英名に寄せる', () => {
  const snap = parseTeamStats(BATTING_HTML, 'batting')
  assert.equal(snap.rows.length, 2)
  const aito = snap.rows[0]
  assert.equal(aito.playerName, '愛斗')
  assert.equal(aito.isLeft, false)
  assert.equal(aito.stats.games, 40)
  assert.equal(aito.stats.hits, 18)
  assert.equal(aito.stats.rbi, 9)
  assert.equal(aito.stats.home_runs, 1)
})

test('parseTeamStats は左打ちの * を名前から外してフラグにする', () => {
  const snap = parseTeamStats(BATTING_HTML, 'batting')
  const sato = snap.rows[1]
  assert.equal(sato.playerName, '佐藤　都志也')
  assert.equal(sato.isLeft, true)
  assert.equal(sato.stats.rbi, 66)
})

test('parseTeamStats は率の列を数値にしない', () => {
  const snap = parseTeamStats(BATTING_HTML, 'batting')
  assert.equal(snap.rows[0].stats['打率'], undefined)
  assert.equal(snap.rows[0].stats['出塁率'], undefined)
})

test('parseTeamStats は投球回をアウト数に直す', () => {
  const snap = parseTeamStats(PITCHING_HTML, 'pitching')
  assert.equal(snap.rows.length, 2)
  // 15回1/3
  assert.equal(snap.rows[0].playerName, '石川　柊太')
  assert.equal(snap.rows[0].stats.innings_outs, 46)
  assert.equal(snap.rows[0].stats.earned_runs, 13)
  // 100回2/3
  assert.equal(snap.rows[1].playerName, '小島　和哉')
  assert.equal(snap.rows[1].stats.innings_outs, 302)
  assert.equal(snap.rows[1].stats.complete_games, 1)
})

test('parseTeamStats は2人分のセルが混ざった行を受け付けない', () => {
  // 行の区切りを取り違えると、2人分のセルが1行に並んだまま
  // それらしい数字が入って通ってしまう（実データの断片で実際に起きた）。
  // 列数がちょうど合う行だけを採るので、混ざった行は残らない。
  const merged = PITCHING_HTML.replace(
    /<\/tr>\s*<tr>\s*<td class="left-hand">/,
    '<td class="left-hand">'
  )
  assert.notEqual(merged, PITCHING_HTML, '差し替えが効いていること')
  // フィクスチャは2行なので、混ざると残る行がゼロになり例外になる
  assert.throws(() => parseTeamStats(merged, 'pitching'), /選手行を取れませんでした/)
})

test('parseTeamStats は正常なページで捨てる行が無い', () => {
  assert.equal(parseTeamStats(PITCHING_HTML, 'pitching').skipped, 0)
  assert.equal(parseTeamStats(BATTING_HTML, 'batting').skipped, 0)
})

test('parseTeamStats は選手行が1つも取れなければ例外にする', () => {
  const empty = PITCHING_HTML.replace(/<tbody>[\s\S]*<\/tbody>/, '<tbody></tbody>')
  assert.throws(() => parseTeamStats(empty, 'pitching'), /選手行を取れませんでした/)
})

test('parseTeamStats は構造が変わったら例外にする', () => {
  const broken = PITCHING_HTML.replace('<span>投球回</span>', '<span>イニング</span>')
  assert.throws(() => parseTeamStats(broken, 'pitching'), /構造が変わっています/)
})

// ---------------------------------------------------------------------------
// 日次差分（貯金ルールの判定）
// ---------------------------------------------------------------------------

test('累計の差分からマルチ安打とQSを判定できる', () => {
  const before = parseTeamStats(BATTING_HTML, 'batting').rows[1].stats
  // 翌日: 1試合出場して3安打2打点
  const after = { ...before, games: before.games + 1, hits: before.hits + 3, rbi: before.rbi + 2 }
  const dGames = after.games - before.games
  const dHits = after.hits - before.hits
  assert.equal(dGames, 1)
  assert.equal(dHits >= 2, true, 'マルチ安打')
  assert.equal(after.rbi - before.rbi, 2)

  const pBefore = parseTeamStats(PITCHING_HTML, 'pitching').rows[0].stats
  // 翌日: 6回2/3 を自責点2で投げた
  const pAfter = {
    ...pBefore,
    appearances: pBefore.appearances + 1,
    innings_outs: pBefore.innings_outs + 20,
    earned_runs: pBefore.earned_runs + 2,
  }
  const dOuts = pAfter.innings_outs - pBefore.innings_outs
  const dEarned = pAfter.earned_runs - pBefore.earned_runs
  assert.equal(pAfter.appearances - pBefore.appearances, 1)
  assert.equal(dOuts >= 18 && dEarned <= 3, true, 'QS')
})

test('得点欄に「中止」と書かれていても拾う', async () => {
  const { parseSchedule } = await import('../schedule')
  // 備考も天候も空で、得点の代わりに中止と書かれている形
  const html = `
    <tr id="date0920">
      <td><div class="team1">ロッテ</div></td>
      <td><div class="score1">中止</div></td>
      <td><div class="score2">中止</div></td>
      <td><div class="team2">西武</div></td>
      <td><div class="place">ZOZOマリン</div></td>
      <td><div class="time">18:00</div></td>
      <td><div class="comment"></div></td>
    </tr>`
  const [game] = parseSchedule(html, 2026)
  assert.equal(game.status, 'cancelled')
  assert.equal(game.note, '中止')
})

test('日付を過ぎても得点の無い試合は中止として扱う', async () => {
  const { withCancelled } = await import('../schedule')
  const base = {
    gameDate: '2026-09-20',
    homeTeam: 'ロッテ',
    awayTeam: '西武',
    homeScore: null,
    awayScore: null,
    place: 'ZOZOマリン',
    startTime: '18:00',
    note: '',
    boxScorePath: '',
    pitchers: [],
    status: 'scheduled' as const,
  }

  const [past] = withCancelled([base], '2026-09-21')
  assert.equal(past.status, 'cancelled')
  assert.equal(past.note, '中止')

  // 当日はまだ決めつけない（試合前・試合中がある）
  const [today] = withCancelled([base], '2026-09-20')
  assert.equal(today.status, 'scheduled')

  // ボックススコアがあるなら行われている。触らない
  const [played] = withCancelled([{ ...base, boxScorePath: '/scores/2026/0920/m-l-20/' }], '2026-09-21')
  assert.equal(played.status, 'scheduled')
})
