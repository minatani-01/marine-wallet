import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  GCAL_TAG,
  GTODO_TAG,
  addDays,
  addMinutes,
  countSummary,
  daysUntil,
  dueGroup,
  dueText,
  eventBody,
  groupTasks,
  isOverdue,
  orderTags,
  rejectCalendarIdReason,
  rejectTagReason,
  rejectTaskReason,
  sortTasks,
  tagTone,
  toPriority,
  toTaskSort,
  todoBody,
  toggleTag,
  wantsEvent,
  wantsTodo,
} from '../tasks'
import type { Task } from '../../types'

const TODAY = '2026-10-31'

function task(over: Partial<Task> = {}): Task {
  return {
    id: over.id ?? 't1',
    user_id: 'u1',
    title: 'やること',
    note: '',
    due_on: null,
    due_time: null,
    priority: 2,
    tags: [],
    done: false,
    done_at: null,
    gcal_event_id: null,
    gcal_synced_at: null,
    gcal_error: '',
    gtask_id: null,
    gtask_synced_at: null,
    gtask_error: '',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...over,
  }
}

test('toPriority: 知らない値は中', () => {
  assert.equal(toPriority(1), 1)
  assert.equal(toPriority(3), 3)
  assert.equal(toPriority(9), 2)
  assert.equal(toPriority('1'), 2)
})

test('toTaskSort: 知らない値は期限順', () => {
  assert.equal(toTaskSort('priority'), 'priority')
  assert.equal(toTaskSort('created'), 'created')
  assert.equal(toTaskSort('x'), 'due')
  assert.equal(toTaskSort(null), 'due')
})

test('addDays / daysUntil: 月またぎと年またぎ', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
  assert.equal(daysUntil('2026-10-31', '2026-11-03'), 3)
  assert.equal(daysUntil('2026-10-31', '2026-10-29'), -2)
})

test('dueText: 近いものは言葉、遠いものは日付、過ぎたものは日数', () => {
  assert.equal(dueText({ due_on: null, due_time: null }, TODAY), '期限なし')
  assert.equal(dueText({ due_on: '2026-10-31', due_time: null }, TODAY), '今日')
  assert.equal(dueText({ due_on: '2026-11-01', due_time: '09:30' }, TODAY), '明日 09:30')
  assert.equal(dueText({ due_on: '2026-10-30', due_time: null }, TODAY), '昨日')
  assert.equal(dueText({ due_on: '2026-10-28', due_time: null }, TODAY), '3日前')
  assert.equal(dueText({ due_on: '2026-11-03', due_time: null }, TODAY), '11/3（火）')
  assert.equal(dueText({ due_on: '2027-01-05', due_time: null }, TODAY), '2027/1/5（火）')
})

test('isOverdue: 済んだものと期限なしは期限切れにならない', () => {
  assert.equal(isOverdue({ due_on: '2026-10-30', done: false }, TODAY), true)
  assert.equal(isOverdue({ due_on: '2026-10-31', done: false }, TODAY), false)
  assert.equal(isOverdue({ due_on: '2026-10-30', done: true }, TODAY), false)
  assert.equal(isOverdue({ due_on: null, done: false }, TODAY), false)
})

test('dueGroup: 期限切れ・今日・明日・今週・あとで・なし', () => {
  assert.equal(dueGroup({ due_on: '2026-10-30' }, TODAY), 'overdue')
  assert.equal(dueGroup({ due_on: '2026-10-31' }, TODAY), 'today')
  assert.equal(dueGroup({ due_on: '2026-11-01' }, TODAY), 'tomorrow')
  assert.equal(dueGroup({ due_on: '2026-11-06' }, TODAY), 'week')
  assert.equal(dueGroup({ due_on: '2026-11-07' }, TODAY), 'later')
  assert.equal(dueGroup({ due_on: null }, TODAY), 'none')
})

test('sortTasks: 期限順は期限なしが後ろ、同じ日は時刻→重要度', () => {
  const rows = [
    task({ id: 'none', due_on: null, priority: 1 }),
    task({ id: 'late', due_on: '2026-11-05' }),
    task({ id: 'today-low', due_on: '2026-10-31', priority: 3 }),
    task({ id: 'today-high', due_on: '2026-10-31', priority: 1 }),
    task({ id: 'today-timed', due_on: '2026-10-31', due_time: '08:00', priority: 3 }),
  ]
  assert.deepEqual(
    sortTasks(rows, 'due').map((t) => t.id),
    ['today-timed', 'today-high', 'today-low', 'late', 'none']
  )
})

test('sortTasks: 重要度順は同じ重さの中を期限で', () => {
  const rows = [
    task({ id: 'mid', priority: 2, due_on: '2026-11-01' }),
    task({ id: 'high-none', priority: 1 }),
    task({ id: 'high-soon', priority: 1, due_on: '2026-10-31' }),
    task({ id: 'low', priority: 3 }),
  ]
  assert.deepEqual(
    sortTasks(rows, 'priority').map((t) => t.id),
    ['high-soon', 'high-none', 'mid', 'low']
  )
})

test('sortTasks: 追加順は新しいものが先', () => {
  const rows = [
    task({ id: 'old', created_at: '2026-10-01T00:00:00Z' }),
    task({ id: 'new', created_at: '2026-10-20T00:00:00Z' }),
  ]
  assert.deepEqual(sortTasks(rows, 'created').map((t) => t.id), ['new', 'old'])
})

test('groupTasks: 空の区切りは出さず、順番は固定', () => {
  const rows = sortTasks(
    [
      task({ id: 'a', due_on: null }),
      task({ id: 'b', due_on: '2026-10-29' }),
      task({ id: 'c', due_on: '2026-10-31' }),
    ],
    'due'
  )
  const groups = groupTasks(rows, 'due', TODAY)
  assert.deepEqual(
    groups.map((g) => [g.label, g.tasks.map((t) => t.id)]),
    [
      ['期限切れ', ['b']],
      ['今日', ['c']],
      ['期限なし', ['a']],
    ]
  )
  const byP = groupTasks(sortTasks([task({ priority: 3 }), task({ id: 'h', priority: 1 })], 'priority'), 'priority', TODAY)
  assert.deepEqual(byP.map((g) => g.label), ['重要度 高', '重要度 低'])
  assert.equal(groupTasks([], 'created', TODAY).length, 0)
  assert.equal(groupTasks([task()], 'created', TODAY)[0].label, '')
})

test('countSummary: 済んだものは数えない', () => {
  const rows = [
    task({ id: 'a', due_on: TODAY }),
    task({ id: 'b', due_on: '2026-10-01' }),
    task({ id: 'c', due_on: '2026-10-01', done: true }),
    task({ id: 'd' }),
  ]
  assert.deepEqual(countSummary(rows, TODAY), { open: 3, today: 1, overdue: 1 })
})

test('rejectTaskReason: 空・長すぎ・形の違う日付と時刻', () => {
  assert.equal(rejectTaskReason({ title: '  ', due_on: null, due_time: null }), 'やることを入れてください')
  assert.equal(rejectTaskReason({ title: 'a'.repeat(201), due_on: null, due_time: null }), '200文字までにしてください')
  assert.equal(rejectTaskReason({ title: 'x', due_on: '2026/11/01', due_time: null }), '期限の日付が読めません')
  assert.equal(rejectTaskReason({ title: 'x', due_on: '2026-11-01', due_time: '25:00' }), '時刻は 09:00 のように入れてください')
  assert.equal(rejectTaskReason({ title: 'x', due_on: null, due_time: '09:00' }), '時刻だけでは期限になりません')
  assert.equal(rejectTaskReason({ title: 'x', due_on: '2026-11-01', due_time: '09:00' }), null)
  assert.equal(rejectTaskReason({ title: 'x', due_on: null, due_time: null }), null)
})

test('タグ: 付け外し・並び・色・検査', () => {
  assert.deepEqual(toggleTag(['仕事'], '買物'), ['仕事', '買物'])
  assert.deepEqual(toggleTag(['仕事', '買物'], '仕事'), ['買物'])
  const order = ['買物', '仕事', GCAL_TAG, GTODO_TAG, '金融']
  assert.deepEqual(orderTags(['金融', '消えた', '買物'], order), ['買物', '金融'])
  assert.equal(tagTone(GCAL_TAG, order), 'border-marine/60 text-marine')
  assert.equal(tagTone(GTODO_TAG, order), 'border-blue-400/60 text-blue-300')
  // 外に出す印のタグを挟んでも、次のタグの色はひとつ進むだけ
  assert.equal(tagTone('金融', order), tagTone('金融', ['買物', '仕事', '金融']))
  assert.equal(tagTone('知らない', order), 'border-line text-fg-mute')
  assert.equal(rejectTagReason(' ', []), 'タグの名前を入れてください')
  assert.equal(rejectTagReason('買物', ['買物']), 'そのタグはもうあります')
  assert.equal(rejectTagReason('a'.repeat(21), []), 'タグは20文字までです')
  assert.equal(rejectTagReason('旅行', []), null)
})

test('wantsEvent: タグと期限の両方があるときだけ', () => {
  assert.equal(wantsEvent({ tags: [GCAL_TAG], due_on: TODAY }), true)
  assert.equal(wantsEvent({ tags: [GCAL_TAG], due_on: null }), false)
  assert.equal(wantsEvent({ tags: ['仕事'], due_on: TODAY }), false)
})

test('rejectCalendarIdReason', () => {
  assert.equal(rejectCalendarIdReason(''), 'カレンダー ID を入れてください')
  assert.equal(rejectCalendarIdReason('abc'), 'カレンダー ID は xxx@group.calendar.google.com の形です')
  assert.equal(rejectCalendarIdReason(' x@group.calendar.google.com '), null)
})

test('addMinutes: 日またぎ', () => {
  assert.deepEqual(addMinutes('09:30', 60), { time: '10:30', carry: 0 })
  assert.deepEqual(addMinutes('23:30', 60), { time: '00:30', carry: 1 })
})

test('eventBody: 終日は翌日が end、時刻ありは1時間', () => {
  const base = task({ id: 't9', title: '家賃', note: '振込', priority: 1, due_on: '2026-11-01' })
  const allDay = eventBody(base)
  assert.deepEqual(allDay?.start, { date: '2026-11-01' })
  assert.deepEqual(allDay?.end, { date: '2026-11-02' })
  assert.equal(allDay?.summary, '家賃')
  assert.equal(allDay?.description, '振込\n重要度: 高\nMarine Wallet のタスク')
  assert.equal(allDay?.extendedProperties.private.marineTaskId, 't9')

  const timed = eventBody({ ...base, due_time: '23:30', done: true })
  assert.deepEqual(timed?.start, { dateTime: '2026-11-01T23:30:00', timeZone: 'Asia/Tokyo' })
  assert.deepEqual(timed?.end, { dateTime: '2026-11-02T00:30:00', timeZone: 'Asia/Tokyo' })
  assert.equal(timed?.summary, '済 家賃')

  assert.equal(eventBody({ ...base, due_on: null }), null)
})

test('wantsTodo / todoBody: 期限が無くても入る。日付だけ。済みは completed', () => {
  assert.equal(wantsTodo({ tags: [GTODO_TAG] }), true)
  assert.equal(wantsTodo({ tags: ['買物'] }), false)

  const open = todoBody(task({ title: '牛乳', note: '低脂肪', priority: 3 }))
  assert.deepEqual(open, {
    title: '牛乳',
    notes: '低脂肪\n重要度: 低\nMarine Wallet のタスク',
    due: null,
    status: 'needsAction',
    completed: null,
  })

  const done = todoBody(task({ title: '家賃', due_on: '2026-11-01', due_time: '15:00', done: true, priority: 1 }))
  assert.equal(done.due, '2026-11-01T00:00:00.000Z')
  assert.equal(done.status, 'completed')
  assert.equal(done.completed, undefined)
  assert.equal(done.notes, '時刻: 15:00\n重要度: 高\nMarine Wallet のタスク')
})
