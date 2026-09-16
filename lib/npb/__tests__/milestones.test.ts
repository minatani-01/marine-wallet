import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  familyName,
  milestoneTitle,
  parseAchievedDate,
  parseCareerMilestones,
  parseRoster,
  parseSeasonMilestones,
  parseUpcomingMilestones,
  splitRecordLabel,
  uniformNumberOf,
} from '../milestones'
import { countdownUnit } from '../../constants'
import type { StatSnapshot } from '../stats'

/**
 * 実データの写し。npb_source_pages に入っている 2026-09-16 取得ぶんから、
 * 判断に関わる部分をそのまま抜き出している。
 *
 * 記録ごとに表が2つ並ぶ。前が「達成済み」（達成日を持つ）、
 * 後ろが「これから」（昨年までの数と、達成までの残り）。
 */
const PITCHING_HTML = `
<div class="wrap">
  <h4>250セーブ（過去4人）</h4>
  <div class="table_center sp_table2 projected">
    <table>
      <thead><tr>
        <th width="110">氏名</th><th width="90">所属</th><th width="70">達成日</th>
        <th width="100">相手</th><th width="40">回戦</th><th width="120">球場</th><th>備考</th>
      </tr></thead>
      <tbody>
        <tr>
          <th>益田 直也</th><td>ロッテ</td><td>2026.8.4</td>
          <td>西　武</td><td>15</td><td>ZOZOマリン</td><td class="left">5人目</td>
        </tr>
        <tr>
          <th>マルティネス</th><td>巨　人</td><td>2026.9.10</td>
          <td>中　日</td><td>23</td><td>東京ドーム</td><td class="left">6人目</td>
        </tr>
      </tbody>
    </table>
  </div>
  <div class="table_center sp_table2">
    <table>
      <thead><tr>
        <th width="110">氏名</th><th width="90">所属</th><th width="60">昨年まで</th>
        <th width="60">達成まで</th><th width="90">初セーブ</th><th width="30">相手</th>
        <th width="40">回戦</th><th width="120">球場</th><th width="40">回</th><th>当時の所属</th>
      </tr></thead>
      <tbody>
        <tr>
          <th>益田 直也</th><td>ロッテ</td><td>248</td><td><span class="red">達成</span></td>
          <td>2012.8.5</td><td>オ</td><td>14</td><td>京セラD大阪</td><td>9回</td><td></td>
        </tr>
        <tr>
          <th>山﨑 康晃</th><td>DeNA</td><td>232</td><td>18</td>
          <td>2015.3.31</td><td>広</td><td>1</td><td>横浜</td><td>9回</td><td></td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
<div class="wrap">
  <h4>800試合登板（過去8人）</h4>
  <div class="table_center sp_table2 projected">
    <table>
      <thead><tr>
        <th width="110">氏名</th><th width="90">所属</th><th width="70">達成日</th>
        <th width="100">相手</th><th width="40">回戦</th><th width="120">球場</th><th>備考</th>
      </tr></thead>
      <tbody>
        <tr>
          <th>益田 直也</th><td>ロッテ</td><td>2026.8.26</td>
          <td>オリックス</td><td>21</td><td>ZOZOマリン</td><td class="left">9人目</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
`

/**
 * 「ロッテ」は所属以外の欄にも出る。
 *   相手       … 他球団の選手がロッテ戦で達成した
 *   当時の所属 … 他球団へ移った選手の、達成時の所属
 * どちらも拾ってはいけない。
 */
const TRAP_HTML = `
<div class="wrap">
  <h4>1500安打（過去139人）</h4>
  <div class="table_center sp_table2 projected">
    <table>
      <thead><tr>
        <th width="110">氏名</th><th width="90">所属</th><th width="70">達成日</th>
        <th width="100">相手</th><th width="40">回戦</th><th width="120">球場</th><th>備考</th>
      </tr></thead>
      <tbody>
        <tr>
          <th>牧原 大成</th><td>ソフトバンク</td><td>2026.7.1</td>
          <td>ロッテ</td><td>10</td><td>みずほPayPay</td><td class="left">140人目</td>
        </tr>
        <tr>
          <th>鈴木 大地</th><td>楽　天</td><td>2026.7.20</td>
          <td>西　武</td><td>12</td><td>ベルーナドーム</td><td class="left">141人目</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
`

const TEAM_HTML = `
<div class="wrap">
  <h4>5000敗（過去8チーム）</h4>
  <div class="table_center sp_table2 projected">
    <table>
      <thead><tr>
        <th width="200">チーム</th><th width="90">達成日</th><th width="90">相手</th>
        <th width="40">回戦</th><th width="120">球場</th><th>回</th><th>打者</th><th>備考</th>
      </tr></thead>
      <tbody>
        <tr>
          <th>千葉ロッテマリーンズ</th><td>2026.5.20</td><td>西　武</td>
          <td>8</td><td>ZOZOマリン</td><td>9回</td><td>&nbsp;</td><td class="left">9チーム目</td>
        </tr>
        <tr>
          <th>広島東洋カープ</th><td>2026.6.10</td><td>西　武</td>
          <td>2</td><td>ベルーナドーム</td><td>9回</td><td>モンテロ</td><td class="left">6チーム目</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
`

const ROSTER_HTML = `
<tr class="rosterMainHead"><th class="rosterNo">No.</th><th class="rosterPos"><a name="pit">投手</a></th></tr>
<tr class="rosterPlayer"><td>86</td><td class="rosterRegister">サブロー</td><td>1976.06.01</td></tr>
<tr class="rosterPlayer"><td>52</td><td class="rosterRegister"><a href="/bis/players/71675135.html">益田　直也</a></td><td>1989.10.25</td></tr>
<tr class="rosterPlayer"><td>14</td><td class="rosterRegister"><a href="/bis/players/61375134.html">小島　和哉</a></td><td>1996.07.07</td></tr>
<tr class="rosterPlayer"><td>51</td><td class="rosterRegister"><a href="/bis/players/81875132.html">山口　航輝</a></td><td>1999.09.08</td></tr>
<tr class="rosterPlayer"><td>99</td><td class="rosterRegister"><a href="/bis/players/03005133.html">ソト</a></td><td>1988.12.07</td></tr>
`

test('達成済みの表から、所属がロッテの行だけを拾う', () => {
  const found = parseCareerMilestones(PITCHING_HTML, 'pitching')

  assert.deepEqual(
    found.map((m) => [m.recordLabel, m.holder, m.achievedOn, m.tier]),
    [
      ['250セーブ', '益田 直也', '2026-08-04', '名球会記録'],
      ['800試合登板', '益田 直也', '2026-08-26', '生涯記録'],
    ]
  )
})

test('「これから」の表からは拾わない（達成日が無い）', () => {
  // 益田は両方の表に出る。達成日を持つ表だけを見るので、250セーブは1件
  const saves = parseCareerMilestones(PITCHING_HTML, 'pitching').filter(
    (m) => m.recordLabel === '250セーブ'
  )
  assert.equal(saves.length, 1)
})

test('相手や当時の所属にある「ロッテ」は拾わない', () => {
  assert.deepEqual(parseCareerMilestones(TRAP_HTML, 'batting'), [])
})

test('チーム記録はチームの列で判定する', () => {
  const found = parseCareerMilestones(TEAM_HTML, 'team')
  assert.equal(found.length, 1)
  assert.equal(found[0].holder, '千葉ロッテマリーンズ')
  assert.equal(found[0].achievedOn, '2026-05-20')
})

test('名鑑から背番号を引く。全角と半角のスペースを揃える', () => {
  const roster = parseRoster(ROSTER_HTML)

  assert.equal(uniformNumberOf(roster, '益田 直也'), '52')
  assert.equal(uniformNumberOf(roster, '益田　直也'), '52')
  assert.equal(uniformNumberOf(roster, 'ソト'), '99')
  // 監督も同じ形の行で出る
  assert.equal(uniformNumberOf(roster, 'サブロー'), '86')
  // 居ない選手は空。内容に「#」を書かない
  assert.equal(uniformNumberOf(roster, '大谷 翔平'), '')
})

test('内容は「#背番号姓 記録名記念」の形になる', () => {
  const roster = parseRoster(ROSTER_HTML)
  const [saves] = parseCareerMilestones(PITCHING_HTML, 'pitching')

  assert.equal(
    milestoneTitle(saves, uniformNumberOf(roster, saves.holder)),
    '#52益田 通算250セーブ記念'
  )
})

test('背番号を引けなければ「#」を付けない', () => {
  const [saves] = parseCareerMilestones(PITCHING_HTML, 'pitching')
  assert.equal(milestoneTitle(saves, ''), '益田 通算250セーブ記念')
})

test('チーム記録の内容には背番号を入れない', () => {
  const [team] = parseCareerMilestones(TEAM_HTML, 'team')
  assert.equal(milestoneTitle(team, ''), 'マリーンズ 5000敗記念')
})

test('姓だけを取り出す。区切りの無いカタカナ名はそのまま', () => {
  assert.equal(familyName('益田 直也'), '益田')
  assert.equal(familyName('小島　和哉'), '小島')
  assert.equal(familyName('ソト'), 'ソト')
})

test('達成日を読む。読めない形は null', () => {
  assert.equal(parseAchievedDate('2026.8.4'), '2026-08-04')
  assert.equal(parseAchievedDate(' 2026.12.31 '), '2026-12-31')
  assert.equal(parseAchievedDate('達成'), null)
  assert.equal(parseAchievedDate('248'), null)
})

test('個人成績から、節目に届いた選手を拾う', () => {
  // 2026-09-15 時点の実データ。山口は30本、横山は33セーブ
  const batting: StatSnapshot = {
    asOf: '2026-09-15',
    columns: [],
    skipped: 0,
    rows: [
      { playerName: '山口　航輝', isLeft: false, stats: { home_runs: 30, rbi: 66, hits: 96 } },
      { playerName: '西川　史礁', isLeft: false, stats: { home_runs: 7, rbi: 46, hits: 136 } },
    ],
  }

  assert.deepEqual(
    parseSeasonMilestones(batting, 'batting').map((m) => [m.recordLabel, m.holder]),
    [['シーズン30本塁打', '山口　航輝']]
  )
})

test('複数の節目を越えていれば、越えた分だけ拾う', () => {
  const pitching: StatSnapshot = {
    asOf: '2026-09-15',
    columns: [],
    skipped: 0,
    rows: [{ playerName: '横山　陸人', isLeft: false, stats: { saves: 41, wins: 2 } }],
  }

  assert.deepEqual(
    parseSeasonMilestones(pitching, 'pitching').map((m) => m.recordLabel),
    ['シーズン30セーブ', 'シーズン40セーブ']
  )
})

test('基準日が読めなければ、シーズン記録は作らない', () => {
  const snapshot: StatSnapshot = {
    asOf: null,
    columns: [],
    skipped: 0,
    rows: [{ playerName: '山口　航輝', isLeft: false, stats: { home_runs: 40 } }],
  }
  assert.deepEqual(parseSeasonMilestones(snapshot, 'batting'), [])
})

test('シーズン記録の内容にも背番号が入る', () => {
  const roster = parseRoster(ROSTER_HTML)
  const snapshot: StatSnapshot = {
    asOf: '2026-09-15',
    columns: [],
    skipped: 0,
    rows: [{ playerName: '山口　航輝', isLeft: false, stats: { home_runs: 30 } }],
  }
  const [hr] = parseSeasonMilestones(snapshot, 'batting')

  assert.equal(milestoneTitle(hr, uniformNumberOf(roster, hr.holder)), '#51山口 シーズン30本塁打記念')
})

/**
 * 「これから」の表。ページの「達成まで」は 目標 − 昨年まで で、
 * 今季ぶんが入っていない。そこは自分たちで数え直す。
 */
const UPCOMING_HTML = `
<div class="wrap">
  <h4>200本塁打（過去115人）</h4>
  <div class="table_center sp_table2">
    <table>
      <thead><tr>
        <th width="110">氏名</th><th width="90">所属</th><th width="60">昨年まで</th>
        <th width="60">達成まで</th><th width="100">初本塁打</th><th width="30">相手</th>
        <th width="40">回戦</th><th width="120">球場</th><th width="40">回</th>
        <th width="100">投手</th><th>当時の所属</th>
      </tr></thead>
      <tbody>
        <tr>
          <th>山口 航輝</th><td>ロッテ</td><td>120</td><td>80</td>
          <td>2020.9.1</td><td>楽</td><td>1</td><td>ZOZOマリン</td><td>5回</td>
          <td>涌井</td><td>&nbsp;</td>
        </tr>
        <tr>
          <th>宮﨑 敏郎</th><td>DeNA</td><td>158</td><td>42</td>
          <td>2013.6.2</td><td>日</td><td>3</td><td>旭川</td><td>8回</td>
          <td>根本</td><td>&nbsp;</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
`

test('カウントダウンは 昨年まで + 今季 で数え直す', () => {
  // 山口は昨年まで120本、今季30本。200本まであと50本
  const stats = new Map([['山口航輝', { home_runs: 30 }]])
  const found = parseUpcomingMilestones(UPCOMING_HTML, 'batting', stats)

  assert.equal(found.length, 1)
  assert.equal(found[0].holder, '山口 航輝')
  assert.equal(found[0].target, 200)
  assert.equal(found[0].unit, '本塁打')
  assert.equal(found[0].current, 150)
  // ページの「達成まで」は80。今季ぶんを足すと50
  assert.equal(found[0].remaining, 50)
})

test('他球団の選手はカウントダウンに出さない', () => {
  const found = parseUpcomingMilestones(UPCOMING_HTML, 'batting', new Map())
  assert.deepEqual(found.map((m) => m.holder), ['山口 航輝'])
})

test('今季の成績が無ければ、昨年までの数で数える', () => {
  const found = parseUpcomingMilestones(UPCOMING_HTML, 'batting', new Map())
  assert.equal(found[0].current, 120)
  assert.equal(found[0].remaining, 80)
})

test('達成済みの表はカウントダウンに混ぜない', () => {
  // 達成日を持つ表しか無いので、カウントダウンは空になる
  assert.deepEqual(parseUpcomingMilestones(PITCHING_HTML, 'pitching', new Map()), [])
})

test('越えていればカウントダウンから外す（達成済みの表が持つ）', () => {
  const stats = new Map([['山口航輝', { home_runs: 90 }]])
  assert.deepEqual(parseUpcomingMilestones(UPCOMING_HTML, 'batting', stats), [])
})

test('記録名から目標の数と単位を取り出す', () => {
  assert.deepEqual(splitRecordLabel('250セーブ'), { target: 250, unit: 'セーブ' })
  assert.deepEqual(splitRecordLabel('1000試合出場'), { target: 1000, unit: '試合出場' })
  // 二塁打・三塁打・本塁打はどれも「塁打」で終わる。長いほうで引き当てる
  assert.deepEqual(splitRecordLabel('500二塁打'), { target: 500, unit: '二塁打' })
  assert.deepEqual(splitRecordLabel('4000塁打'), { target: 4000, unit: '塁打' })
  assert.equal(splitRecordLabel('サイクルヒット'), null)
})

test('カウントダウンの単位は読みやすい言い方に直す', () => {
  // 「あと8試合出場」では読みにくい。1日1試合なので「あと8日」
  assert.equal(countdownUnit('試合出場'), '日')
  // そのままで意味が通るものは記録名のまま
  assert.equal(countdownUnit('本塁打'), '本塁打')
  assert.equal(countdownUnit('セーブ'), 'セーブ')
  assert.equal(countdownUnit('死球'), '死球')
})
