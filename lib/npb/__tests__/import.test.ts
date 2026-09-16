import { test } from 'node:test'
import assert from 'node:assert/strict'

import { countMarinesHomeRuns, gameFromNpb, opponentIdFromLabel } from '../import'
import type { NpbGameSource } from '../import'

/**
 * 実データは 2026-09-15 の日本ハム戦（npb_games に入っているもの）。
 * 日本ハム 6 - 7 ロッテ。山口が2本（29号2ラン / 30号ソロ）、万波が相手の1本。
 * 勝 中森 / 敗 柳川 / S 横山。
 */
const REAL: NpbGameSource = {
  game_date: '2026-09-15',
  home_team: '日本ハム',
  away_team: 'ロッテ',
  home_score: 6,
  away_score: 7,
  place: 'エスコンフィールド',
  phase: 'regular',
  status: 'finished',
  save_pitcher: '横山',
  raw: {
    box: {
      state: '試合終了',
      seriesLabel: 'パーソル パ・リーグ公式戦',
      homeRuns: [
        { team: 'ロッテ', batter: '山口', detail: '山口 29号（6回2ラン 田中）' },
        { team: 'ロッテ', batter: '山口', detail: '山口 30号（9回ソロ 柳川）' },
        { team: '日本ハム', batter: '万波', detail: '万波 21号（8回ソロ 中森）' },
      ],
    },
  },
}

const ok = (row: NpbGameSource) => {
  const result = gameFromNpb(row)
  if (!result.ok) throw new Error(`取り込めなかった: ${result.reason}`)
  return result.game
}

const reason = (row: NpbGameSource) => {
  const result = gameFromNpb(row)
  assert.equal(result.ok, false)
  return result.ok ? '' : result.reason
}

test('実データ（2026-09-15 日本ハム戦）を取り込む', () => {
  const game = ok(REAL)
  assert.equal(game.game_date, '2026-09-15')
  assert.equal(game.opponent, 'fighters')
  assert.equal(game.home_away, 'away')
  assert.equal(game.result, 'win')
  assert.equal(game.marines_score, 7)
  assert.equal(game.opponent_score, 6)
  // 相手の本塁打は数えない
  assert.equal(game.home_runs, 2)
  assert.equal(game.grand_slams, 0)
  assert.equal(game.has_save, true)
  assert.equal(game.source, 'npb')
})

test('自動では埋めない項目は既定値のままにする', () => {
  const game = ok(REAL)
  // イニング別得点を取っていないので判定できない
  assert.equal(game.is_sayonara, false)
  // 勝てば必ず自軍から出るので、入れると全勝利に上乗せが付く
  assert.equal(game.is_winning_pitcher, false)
  // 投球回を取っていないので完封・完投を判定できない
  assert.equal(game.pitching_highlight, 'none')
  // 個人別の打撃成績は NPB 公式が公開していない
  assert.equal(game.multi_hits, 0)
  assert.equal(game.rbi, 0)
})

test('ホームの試合は home になる', () => {
  const game = ok({ ...REAL, home_team: 'ロッテ', away_team: '西武', home_score: 7, away_score: 6 })
  assert.equal(game.home_away, 'home')
  assert.equal(game.opponent, 'lions')
  assert.equal(game.result, 'win')
})

test('勝敗と引き分けを得点から決める', () => {
  assert.equal(ok({ ...REAL, home_score: 8, away_score: 1 }).result, 'lose')
  assert.equal(ok({ ...REAL, home_score: 3, away_score: 3 }).result, 'draw')
})

test('負け試合では相手のセーブを拾わない', () => {
  const game = ok({ ...REAL, home_score: 9, away_score: 2 })
  assert.equal(game.result, 'lose')
  assert.equal(game.has_save, false)
})

test('満塁本塁打は別に数え、home_runs には含めない', () => {
  assert.deepEqual(
    countMarinesHomeRuns([
      { team: 'ロッテ', batter: '山口', detail: '山口 29号（6回2ラン 田中）' },
      { team: 'ロッテ', batter: 'ソト', detail: 'ソト 10号（7回満塁 宮西）' },
      { team: '西武', batter: '外崎', detail: '外崎 5号（8回ソロ 益田）' },
    ]),
    { home_runs: 1, grand_slams: 1 }
  )
})

test('終わっていない試合は取り込まない', () => {
  assert.match(reason({ ...REAL, status: 'scheduled' }), /終わっていません/)
})

test('得点が無い（中止など）は取り込まない', () => {
  assert.match(reason({ ...REAL, home_score: null, away_score: null }), /得点/)
})

test('マリーンズが出ない試合は取り込まない', () => {
  assert.match(reason({ ...REAL, home_team: '西武', away_team: '楽天' }), /マリーンズの試合/)
})

test('知らない球団名は当てずっぽうにしない', () => {
  assert.match(reason({ ...REAL, home_team: '未知の球団' }), /対戦相手を判別できません/)
  assert.equal(opponentIdFromLabel('日本ハム'), 'fighters')
  assert.equal(opponentIdFromLabel('マリーンズ'), null)
})

test('ボックススコアが無いと取り込まない（0本で確定させない）', () => {
  assert.match(reason({ ...REAL, raw: { box: null } }), /ボックススコア/)
  assert.match(reason({ ...REAL, raw: {} }), /ボックススコア/)
})
