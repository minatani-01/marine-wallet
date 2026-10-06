import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildContributors,
  contributorsLine,
  hasContributors,
  holdPitchers,
  homeRunNumber,
  lookupNumber,
  marinesHomeRuns,
} from '@/lib/npb/contributors'
import { parseRoster } from '@/lib/npb/milestones'

/** 名鑑の形。実物と同じ並びにしてある */
const ROSTER_HTML = `
<tr class="rosterPlayer"><td>14</td><td class="rosterRegister"><a href="#">小島　和哉</a></td></tr>
<tr class="rosterPlayer"><td>15</td><td class="rosterRegister"><a href="#">横山　陸人</a></td></tr>
<tr class="rosterPlayer"><td>47</td><td class="rosterRegister"><a href="#">鈴木　昭汰</a></td></tr>
<tr class="rosterPlayer"><td>56</td><td class="rosterRegister"><a href="#">中森　俊介</a></td></tr>
<tr class="rosterPlayer"><td>51</td><td class="rosterRegister"><a href="#">山口　航輝</a></td></tr>
<tr class="rosterPlayer"><td>10</td><td class="rosterRegister"><a href="#">上田　希由翔</a></td></tr>
<tr class="rosterPlayer"><td>21</td><td class="rosterRegister"><a href="#">石川　柊太</a></td></tr>
<tr class="rosterPlayer"><td>23</td><td class="rosterRegister"><a href="#">石川　慎吾</a></td></tr>
`
const roster = parseRoster(ROSTER_HTML)

test('姓だけでも背番号を引ける', () => {
  // ボックススコアは姓だけで書く
  assert.equal(lookupNumber(roster, '山口'), '51')
  assert.equal(lookupNumber(roster, '横山'), '15')
  // 成績ページはフルネーム。全角の空白も通る
  assert.equal(lookupNumber(roster, '鈴木　昭汰'), '47')
  assert.equal(lookupNumber(roster, '中森 俊介'), '56')
})

test('同姓が2人いるときは引かない', () => {
  // 石川が2人いる。番号を間違えるくらいなら出さない
  assert.equal(lookupNumber(roster, '石川'), '')
  // 書き分けてあれば引ける
  assert.equal(lookupNumber(roster, '石川柊太'), '21')
  assert.equal(lookupNumber(roster, ''), '')
  // 名鑑に居ない相手の投手
  assert.equal(lookupNumber(roster, '早川'), '')
})

test('本塁打は号数だけ取り出す', () => {
  assert.equal(homeRunNumber('山口 36号（4回2ラン 早川）'), '36号')
  assert.equal(homeRunNumber('上田 8号（8回ソロ 松本晴）'), '8号')
  assert.equal(homeRunNumber('よく分からない行'), '')
})

test('マリーンズの本塁打だけを残す', () => {
  const hits = marinesHomeRuns(
    [
      { team: 'ソフトバンク', batter: '近藤', detail: '近藤 32号（1回ソロ 田中）' },
      { team: 'ロッテ', batter: '上田', detail: '上田 8号（8回ソロ 松本晴）' },
      { team: 'ロッテ', batter: '山口', detail: '山口 35号（9回ソロ 松本裕）' },
    ],
    roster
  )

  assert.deepEqual(hits, [
    { number: '10', name: '上田', no: '8号' },
    { number: '51', name: '山口', no: '35号' },
  ])
})

/** 個人投手成績の1行 */
const p = (name: string, holds: number) => ({ player_name: name, stats: { ホールド: holds } })

test('前日から増えた投手だけをホールドとする', () => {
  // 10/2 の実データ。鈴木と中森が増えている
  const before = [p('鈴木　昭汰', 32), p('中森　俊介', 17), p('横山　陸人', 7)]
  const after = [p('鈴木　昭汰', 33), p('中森　俊介', 18), p('横山　陸人', 7)]

  assert.deepEqual(holdPitchers(before, after), ['鈴木　昭汰', '中森　俊介'])
})

test('試合が無ければ空', () => {
  const same = [p('鈴木　昭汰', 33), p('中森　俊介', 19)]
  assert.deepEqual(holdPitchers(same, same), [])
  assert.deepEqual(holdPitchers([], []), [])
})

test('前日に居なかった投手は0から数える', () => {
  // 昇格した直後。その日に付いたぶんだけ出す
  assert.deepEqual(holdPitchers([], [p('中森　俊介', 1)]), ['中森　俊介'])
  // 減ることはないが、減っていたら出さない（記録の訂正など）
  assert.deepEqual(holdPitchers([p('中森　俊介', 5)], [p('中森　俊介', 4)]), [])
})

test('勝った試合は勝利投手とセーブを出す', () => {
  // 10/4 の実データ。3-2 で勝ち、山口が2本
  const c = buildContributors({
    rosterHtml: ROSTER_HTML,
    homeRuns: [
      { team: 'ロッテ', batter: '山口', detail: '山口 36号（4回2ラン 早川）' },
      { team: 'ロッテ', batter: '山口', detail: '山口 37号（6回ソロ 早川）' },
    ],
    winPitcher: '小島',
    savePitcher: '横山',
    isWin: true,
    pitchingBefore: [p('中森　俊介', 18)],
    pitchingAfter: [p('中森　俊介', 19)],
  })

  assert.deepEqual(c.home_runs, [
    { number: '51', name: '山口', no: '36号' },
    { number: '51', name: '山口', no: '37号' },
  ])
  assert.deepEqual(c.win, { number: '14', name: '小島' })
  assert.deepEqual(c.save, { number: '15', name: '横山' })
  assert.deepEqual(c.holds, [{ number: '56', name: '中森' }])
  assert.equal(hasContributors(c), true)
})

test('負けた試合は勝利投手とセーブを出さない', () => {
  // 10/5 の実データ。1-7 で負け。勝利投手は相手の篠原なので出さない
  const c = buildContributors({
    rosterHtml: ROSTER_HTML,
    homeRuns: [{ team: 'ロッテ', batter: '山口', detail: '山口 38号（3回ソロ 髙橋光成）' }],
    winPitcher: '篠原',
    savePitcher: '',
    isWin: false,
    pitchingBefore: [p('中森　俊介', 19)],
    pitchingAfter: [p('中森　俊介', 19)],
  })

  assert.equal(c.win, null)
  assert.equal(c.save, null)
  assert.deepEqual(c.holds, [])
  // 負けても本塁打は残す
  assert.deepEqual(c.home_runs, [{ number: '51', name: '山口', no: '38号' }])
  assert.equal(hasContributors(c), true)
})

test('名鑑が無くても名前だけで出す', () => {
  const c = buildContributors({
    rosterHtml: null,
    homeRuns: [{ team: 'ロッテ', batter: '山口', detail: '山口 38号（3回ソロ 大谷）' }],
    winPitcher: '小島',
    savePitcher: '',
    isWin: true,
    pitchingBefore: [],
    pitchingAfter: [],
  })

  assert.deepEqual(c.home_runs, [{ number: '', name: '山口', no: '38号' }])
  assert.deepEqual(c.win, { number: '', name: '小島' })
  // セーブの付かない試合
  assert.equal(c.save, null)
})

test('何も無い試合は行を足さない', () => {
  const c = buildContributors({
    rosterHtml: ROSTER_HTML,
    homeRuns: [],
    winPitcher: '',
    savePitcher: '',
    isWin: false,
    pitchingBefore: [],
    pitchingAfter: [],
  })

  assert.equal(hasContributors(c), false)
  assert.equal(hasContributors(null), false)
})

test('1行にまとめて出す', () => {
  const line = contributorsLine({
    home_runs: [
      { number: '51', name: '山口', no: '36号' },
      { number: '51', name: '山口', no: '37号' },
    ],
    win: { number: '14', name: '小島' },
    save: { number: '15', name: '横山' },
    holds: [{ number: '56', name: '中森' }],
  })

  assert.equal(line, '#51 山口 36号 37号 ・ W #14 小島 ・ S #15 横山 ・ H #56 中森')
})

test('無いものは書かない', () => {
  // 負けた試合。本塁打だけ
  assert.equal(
    contributorsLine({
      home_runs: [{ number: '51', name: '山口', no: '38号' }],
      win: null,
      save: null,
      holds: [],
    }),
    '#51 山口 38号'
  )
  // セーブの付かない勝ち方。ホールドが2人
  assert.equal(
    contributorsLine({
      home_runs: [],
      win: { number: '15', name: '横山' },
      save: null,
      holds: [
        { number: '47', name: '鈴木' },
        { number: '56', name: '中森' },
      ],
    }),
    'W #15 横山 ・ H #47 鈴木 #56 中森'
  )
  // 背番号が引けないときは名前だけ
  assert.equal(
    contributorsLine({ home_runs: [], win: { number: '', name: '小島' }, save: null, holds: [] }),
    'W 小島'
  )
  assert.equal(contributorsLine(null), '')
})
