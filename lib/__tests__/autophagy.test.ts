import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_WINDOW,
  dueBoundary,
  eatingMinutes,
  fastingMinutes,
  isEating,
  jstMinutes,
  nextBoundary,
  spanText,
  toHhmm,
  toMinutes,
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

test('日をまたぐ時間でも、食べてよいかを判定できる', () => {
  // 18:00〜翌2:00
  assert.equal(isEating(DEFAULT_WINDOW, toMinutes('18:00')!), true)
  assert.equal(isEating(DEFAULT_WINDOW, toMinutes('23:30')!), true)
  assert.equal(isEating(DEFAULT_WINDOW, toMinutes('01:59')!), true)
  // 境目そのものは、もう食べない時間に入っている
  assert.equal(isEating(DEFAULT_WINDOW, toMinutes('02:00')!), false)
  assert.equal(isEating(DEFAULT_WINDOW, toMinutes('12:00')!), false)
  assert.equal(isEating(DEFAULT_WINDOW, toMinutes('17:59')!), false)
})

test('日をまたがない時間でも判定できる', () => {
  const day = { eat_start: '08:00', eat_end: '20:00' }
  assert.equal(isEating(day, toMinutes('07:59')!), false)
  assert.equal(isEating(day, toMinutes('08:00')!), true)
  assert.equal(isEating(day, toMinutes('19:59')!), true)
  assert.equal(isEating(day, toMinutes('20:00')!), false)
  assert.equal(isEating(day, toMinutes('03:00')!), false)
})

test('始まりと終わりが同じときは、ずっと食べてよい', () => {
  // 設定を触っている途中に断食が始まると困る。食べない時間が0分になるほうを選ぶ
  const same = { eat_start: '09:00', eat_end: '09:00' }
  assert.equal(isEating(same, toMinutes('09:00')!), true)
  assert.equal(isEating(same, toMinutes('03:00')!), true)
  assert.equal(nextBoundary(same, toMinutes('09:00')!), null)
  assert.equal(eatingMinutes(same), 1440)
  assert.equal(fastingMinutes(same), 0)
})

test('次の境目が分かる', () => {
  // 断食中の昼。次は18:00から食べてよい
  assert.deepEqual(nextBoundary(DEFAULT_WINDOW, toMinutes('12:00')!), {
    kind: 'eat',
    at: '18:00',
    inMinutes: 360,
  })
  // 食べている夜。次は2:00から断食
  assert.deepEqual(nextBoundary(DEFAULT_WINDOW, toMinutes('23:00')!), {
    kind: 'fast',
    at: '02:00',
    inMinutes: 180,
  })
  // 日をまたいだ直後も同じ
  assert.deepEqual(nextBoundary(DEFAULT_WINDOW, toMinutes('01:30')!), {
    kind: 'fast',
    at: '02:00',
    inMinutes: 30,
  })
  // ちょうど境目。次の境目は反対側になる
  assert.deepEqual(nextBoundary(DEFAULT_WINDOW, toMinutes('18:00')!), {
    kind: 'fast',
    at: '02:00',
    inMinutes: 480,
  })
})

test('食べる時間と食べない時間の長さが出る', () => {
  // 18:00〜翌2:00 は8時間。残り16時間が断食
  assert.equal(eatingMinutes(DEFAULT_WINDOW), 480)
  assert.equal(fastingMinutes(DEFAULT_WINDOW), 960)

  const day = { eat_start: '08:00', eat_end: '20:00' }
  assert.equal(eatingMinutes(day), 720)
  assert.equal(fastingMinutes(day), 720)
})

test('残り時間の書き方', () => {
  assert.equal(spanText(0), '0分')
  assert.equal(spanText(45), '45分')
  assert.equal(spanText(60), '1時間')
  assert.equal(spanText(200), '3時間20分')
  assert.equal(spanText(960), '16時間')
})

test('境目を跨いだ直後だけ、送る通知がある', () => {
  // 18:00 ちょうどから5分のあいだは「食べてOK」
  assert.equal(dueBoundary(DEFAULT_WINDOW, toMinutes('18:00')!), 'eat')
  assert.equal(dueBoundary(DEFAULT_WINDOW, toMinutes('18:04')!), 'eat')
  assert.equal(dueBoundary(DEFAULT_WINDOW, toMinutes('18:05')!), null)
  assert.equal(dueBoundary(DEFAULT_WINDOW, toMinutes('17:59')!), null)

  // 2:00 ちょうどから5分のあいだは「断食開始」
  assert.equal(dueBoundary(DEFAULT_WINDOW, toMinutes('02:00')!), 'fast')
  assert.equal(dueBoundary(DEFAULT_WINDOW, toMinutes('02:03')!), 'fast')
  assert.equal(dueBoundary(DEFAULT_WINDOW, toMinutes('02:05')!), null)

  // 何も無い時間
  assert.equal(dueBoundary(DEFAULT_WINDOW, toMinutes('12:00')!), null)

  // 幅を狭めれば、その中だけになる
  assert.equal(dueBoundary(DEFAULT_WINDOW, toMinutes('18:02')!, 1), null)
  assert.equal(dueBoundary(DEFAULT_WINDOW, toMinutes('18:00')!, 1), 'eat')
})

test('日本時間に読み替えて分を出す', () => {
  // 2026-09-25 09:00 UTC = 18:00 JST
  assert.equal(jstMinutes(new Date('2026-09-25T09:00:00Z')), 1080)
  // 2026-09-25 17:00 UTC = 翌2:00 JST。日をまたいでも0時からの分で返す
  assert.equal(jstMinutes(new Date('2026-09-25T17:00:00Z')), 120)
  assert.equal(jstMinutes(new Date('2026-09-25T15:00:00Z')), 0)
})
