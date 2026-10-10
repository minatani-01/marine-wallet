import { test } from 'node:test'
import assert from 'node:assert/strict'

import { pickDraft, type WorkoutDraft } from '@/lib/workout-draft'

/**
 * やりかけのワークアウト（0064）。
 *
 * 読み戻してよいかどうかの決まりを固定する。ここを間違えると、
 * 前の日のやりかけが今日の記録として立ったり、端末を共有している相手の
 * 入力が出たりする。
 */

const draft = (over: Partial<WorkoutDraft> = {}): WorkoutDraft => ({
  user_id: 'u1',
  date: '2026-10-10',
  started_at: 1_760_000_000_000,
  exercises: [
    {
      planned: {
        exercise_id: 'leg_press',
        name: 'レッグプレス',
        kind: 'strength',
        target_weight: 35,
        target_reps: 10,
        target_sets: 2,
        target_minutes: null,
        reason: '身長・体重・年齢から初回負荷を推定',
      },
      actual_weight: '35',
      actual_reps: ['10', '9'],
      actual_minutes: '',
      effort: 'normal',
    },
  ],
  ...over,
})

test('同じ人の同じ日のものだけ読み戻す', () => {
  const raw = JSON.stringify(draft())

  const held = pickDraft(raw, 'u1', '2026-10-10')
  assert.equal(held?.exercises[0].actual_reps[1], '9')
  assert.equal(held?.started_at, 1_760_000_000_000)

  // 端末を共有していても、相手の入力は出さない
  assert.equal(pickDraft(raw, 'u2', '2026-10-10'), null)
  // 前の日のやりかけ。今日の記録として立てない
  assert.equal(pickDraft(raw, 'u1', '2026-10-11'), null)
})

test('壊れているもの・空のものは無いものとして扱う', () => {
  assert.equal(pickDraft(null, 'u1', '2026-10-10'), null)
  assert.equal(pickDraft('', 'u1', '2026-10-10'), null)
  assert.equal(pickDraft('{壊れている', 'u1', '2026-10-10'), null)
  assert.equal(pickDraft('null', 'u1', '2026-10-10'), null)
  assert.equal(pickDraft('"文字列"', 'u1', '2026-10-10'), null)
  // 種目が1つも無い下書きを戻しても、押すものが無い
  assert.equal(pickDraft(JSON.stringify(draft({ exercises: [] })), 'u1', '2026-10-10'), null)
})

test('始めた時刻が壊れていても捨てない', () => {
  // 時刻はかかった時間を出すだけに使う。入力した回数のほうが惜しい
  const raw = JSON.stringify({ ...draft(), started_at: 'こわれている' })
  const held = pickDraft(raw, 'u1', '2026-10-10')

  assert.equal(held?.exercises.length, 1)
  assert.equal(typeof held?.started_at, 'number')
})
