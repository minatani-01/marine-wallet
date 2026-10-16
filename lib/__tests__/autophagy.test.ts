import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_PLAN,
  DEFAULT_SLEEP,
  dueBoundary,
  eatingMinutes,
  fastEnd,
  fastingMinutes,
  isFasting,
  jstMinutes,
  isAsleep,
  nextBoundary,
  sleepInsideFast,
  spanText,
  toHhmm,
  toMinutes,
  wakeAt,
} from '@/lib/autophagy'

test('HH:MM と分を行き来できる', () => {
  assert.equal(toMinutes('18:00'), 1080)
  assert.equal(toMinutes('02:00'), 120)
  assert.equal(toMinutes('0:05'), 5)
  assert.equal(toMinutes('23:59'), 1439)
  assert.equal(toMinutes('24:00'), null)
  assert.equal(toMinutes('12:60'), null)
  assert.equal(toMinutes(''), null)

  assert.equal(toHhmm(1080), '18:00')
  assert.equal(toHhmm(120), '02:00')
  // 1日を超えたら回り込む
  assert.equal(toHhmm(1500), '01:00')
})

test('終わりは始まりと長さから出る。入れてもらわない', () => {
  // 2:00 から16時間 → 18:00
  assert.equal(fastEnd(DEFAULT_PLAN), '18:00')
  // 日をまたぐ
  assert.equal(fastEnd({ fast_start: '22:00', fast_hours: 8 }), '06:00')
  // ちょうど深夜0時に終わる
  assert.equal(fastEnd({ fast_start: '12:00', fast_hours: 12 }), '00:00')

  // 長さが使えない値なら出さない。境目が無くなってしまう
  assert.equal(fastEnd({ fast_start: '02:00', fast_hours: 0 }), null)
  assert.equal(fastEnd({ fast_start: '02:00', fast_hours: 24 }), null)
  assert.equal(fastEnd({ fast_start: 'あさ', fast_hours: 16 }), null)
})

test('食べてはいけない時間かを判定できる', () => {
  // 2:00 から16時間（〜18:00）
  assert.equal(isFasting(DEFAULT_PLAN, toMinutes('02:00')!), true)
  assert.equal(isFasting(DEFAULT_PLAN, toMinutes('12:00')!), true)
  assert.equal(isFasting(DEFAULT_PLAN, toMinutes('17:59')!), true)
  // 終わりちょうどは、もう食べてよい
  assert.equal(isFasting(DEFAULT_PLAN, toMinutes('18:00')!), false)
  assert.equal(isFasting(DEFAULT_PLAN, toMinutes('23:30')!), false)
  assert.equal(isFasting(DEFAULT_PLAN, toMinutes('01:59')!), false)
})

test('日をまたぐ断食でも判定できる', () => {
  // 22:00 から8時間（〜翌6:00）
  const night = { fast_start: '22:00', fast_hours: 8 }
  assert.equal(isFasting(night, toMinutes('21:59')!), false)
  assert.equal(isFasting(night, toMinutes('22:00')!), true)
  assert.equal(isFasting(night, toMinutes('03:00')!), true)
  assert.equal(isFasting(night, toMinutes('05:59')!), true)
  assert.equal(isFasting(night, toMinutes('06:00')!), false)
})

test('次の境目が分かる', () => {
  // 断食中の昼。次は18:00に解禁
  assert.deepEqual(nextBoundary(DEFAULT_PLAN, toMinutes('12:00')!), {
    kind: 'eat',
    at: '18:00',
    inMinutes: 360,
  })
  // 食べている夜。次は2:00から断食
  assert.deepEqual(nextBoundary(DEFAULT_PLAN, toMinutes('23:00')!), {
    kind: 'fast',
    at: '02:00',
    inMinutes: 180,
  })
  // 日をまたいだ直後も同じ
  assert.deepEqual(nextBoundary(DEFAULT_PLAN, toMinutes('01:30')!), {
    kind: 'fast',
    at: '02:00',
    inMinutes: 30,
  })
  // ちょうど境目。次の境目は反対側になる
  assert.deepEqual(nextBoundary(DEFAULT_PLAN, toMinutes('02:00')!), {
    kind: 'eat',
    at: '18:00',
    inMinutes: 960,
  })
  assert.equal(nextBoundary({ fast_start: '02:00', fast_hours: 0 }, 0), null)
})

test('食べる時間と食べない時間の長さが出る', () => {
  assert.equal(fastingMinutes(DEFAULT_PLAN), 960)
  assert.equal(eatingMinutes(DEFAULT_PLAN), 480)

  const half = { fast_start: '20:00', fast_hours: 12 }
  assert.equal(fastingMinutes(half), 720)
  assert.equal(eatingMinutes(half), 720)

  assert.equal(fastingMinutes({ fast_start: '02:00', fast_hours: 24 }), null)
})

test('寝ている時間も始まりと長さで持つ', () => {
  assert.equal(wakeAt(DEFAULT_SLEEP), '06:00')
  assert.equal(wakeAt({ sleep_start: '01:30', sleep_hours: 6 }), '07:30')
  // 使えない長さなら出さない
  assert.equal(wakeAt({ sleep_start: '23:00', sleep_hours: 0 }), null)
  assert.equal(wakeAt({ sleep_start: 'なんとか', sleep_hours: 7 }), null)

  // 日をまたぐ。23:00〜翌6:00
  assert.equal(isAsleep(DEFAULT_SLEEP, toMinutes('23:30')!), true)
  assert.equal(isAsleep(DEFAULT_SLEEP, toMinutes('03:00')!), true)
  assert.equal(isAsleep(DEFAULT_SLEEP, toMinutes('06:00')!), false)
  assert.equal(isAsleep(DEFAULT_SLEEP, toMinutes('12:00')!), false)
})

test('食べない時間のうち、寝ているぶんが出る', () => {
  // 18:00から16時間（18:00〜翌10:00）と、23:00から7時間（23:00〜翌6:00）。
  // 睡眠はまるごと断食の中に入る
  assert.equal(sleepInsideFast({ fast_start: '18:00', fast_hours: 16 }, DEFAULT_SLEEP), 7 * 60)

  // 2:00から16時間（2:00〜18:00）。睡眠 23:00〜6:00 のうち 2:00〜6:00 だけ重なる
  assert.equal(sleepInsideFast(DEFAULT_PLAN, DEFAULT_SLEEP), 4 * 60)

  // 重ならないこともある
  assert.equal(
    sleepInsideFast({ fast_start: '08:00', fast_hours: 8 }, DEFAULT_SLEEP),
    0
  )

  // 読めない値なら出さない
  assert.equal(sleepInsideFast({ fast_start: 'x', fast_hours: 16 }, DEFAULT_SLEEP), null)
})

test('残り時間の書き方', () => {
  assert.equal(spanText(0), '0分')
  assert.equal(spanText(45), '45分')
  assert.equal(spanText(60), '1時間')
  assert.equal(spanText(200), '3時間20分')
  assert.equal(spanText(960), '16時間')
})

test('境目を跨いだ直後だけ、送る通知がある', () => {
  // 2:00 ちょうどから5分のあいだは「断食開始」
  assert.equal(dueBoundary(DEFAULT_PLAN, toMinutes('02:00')!), 'fast')
  assert.equal(dueBoundary(DEFAULT_PLAN, toMinutes('02:04')!), 'fast')
  assert.equal(dueBoundary(DEFAULT_PLAN, toMinutes('02:05')!), null)
  assert.equal(dueBoundary(DEFAULT_PLAN, toMinutes('01:59')!), null)

  // 18:00 ちょうどから5分のあいだは「解禁」
  assert.equal(dueBoundary(DEFAULT_PLAN, toMinutes('18:00')!), 'eat')
  assert.equal(dueBoundary(DEFAULT_PLAN, toMinutes('18:03')!), 'eat')
  assert.equal(dueBoundary(DEFAULT_PLAN, toMinutes('18:05')!), null)

  // 何も無い時間
  assert.equal(dueBoundary(DEFAULT_PLAN, toMinutes('12:00')!), null)

  // 幅を狭めれば、その中だけになる
  assert.equal(dueBoundary(DEFAULT_PLAN, toMinutes('02:02')!, 1), null)
  assert.equal(dueBoundary(DEFAULT_PLAN, toMinutes('02:00')!, 1), 'fast')
})

test('日本時間に読み替えて分を出す', () => {
  // 2026-09-25 09:00 UTC = 18:00 JST
  assert.equal(jstMinutes(new Date('2026-09-25T09:00:00Z')), 1080)
  // 2026-09-25 17:00 UTC = 翌2:00 JST。日をまたいでも0時からの分で返す
  assert.equal(jstMinutes(new Date('2026-09-25T17:00:00Z')), 120)
  assert.equal(jstMinutes(new Date('2026-09-25T15:00:00Z')), 0)
})
