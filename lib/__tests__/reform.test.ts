import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  EXERCISES,
  ageFactor,
  bmi,
  daysBetween,
  effectiveWeight,
  floorTo,
  generatePlan,
  initialWeight,
  lastResultsOf,
  planExercise,
  planText,
  rejectProfileReason,
  rejectSaunaReason,
  sinceText,
  weightTrend,
  type LastResult,
} from '@/lib/reform'
import type { BodyProfile, WorkoutExercise } from '@/types'

/**
 * 負荷の決め方（0064）。
 *
 * もとの Google Apps Script のアプリから移したもの。数字を変えると、
 * これまでの記録の続きとして読めなくなるので、規則をここで固定する。
 */

const profile = (over: Partial<BodyProfile> = {}): BodyProfile => ({
  user_id: 'u',
  height: 170,
  weight: 70,
  age: 35,
  goal: 'health',
  target_weight: null,
  increment: 5,
  created_at: '',
  updated_at: '',
  ...over,
})

const legPress = EXERCISES[0]
const abBench = EXERCISES[3]
const cardio = EXERCISES[4]

const last = (over: Partial<WorkoutExercise> = {}, date = '2026-10-01'): LastResult => ({
  date,
  exercise: {
    target_weight: 40,
    actual_weight: 40,
    target_reps: 10,
    actual_reps: [10, 10],
    target_sets: 2,
    effort: 'normal',
    ...over,
  },
})

test('年齢で控えめにする', () => {
  assert.equal(ageFactor(35), 1)
  assert.equal(ageFactor(40), 0.95)
  assert.equal(ageFactor(55), 0.9)
  assert.equal(ageFactor(65), 0.85)
  assert.equal(ageFactor(70), 0.75)
})

test('刻みに切り下げる。0kg にはしない', () => {
  assert.equal(floorTo(43, 5), 40)
  assert.equal(floorTo(43, 2.5), 42.5)
  // 計算が刻みを下回っても、1段階ぶんは残す
  assert.equal(floorTo(1, 5), 5)
})

test('負荷計算用の体重は BMI25 相当で抑える', () => {
  // 170cm の BMI25 は 72.25kg。それより軽ければ実体重のまま
  assert.equal(effectiveWeight(170, 70), 70)
  // 重い人は抑える。初回から重い設定にならないようにする
  assert.equal(Math.round(effectiveWeight(170, 90) * 100) / 100, 72.25)
})

test('BMI', () => {
  assert.equal(Math.round((bmi(170, 72.25) ?? 0) * 100) / 100, 25)
  assert.equal(bmi(0, 70), null)
})

test('日数は月をまたいでも合う', () => {
  assert.equal(daysBetween('2026-10-01', '2026-10-08'), 7)
  assert.equal(daysBetween('2026-09-28', '2026-10-02'), 4)
  assert.equal(daysBetween('2026-10-08', '2026-10-08'), 0)
  // 年をまたぐ
  assert.equal(daysBetween('2025-12-31', '2026-01-01'), 1)
})

test('初回の重量は身長・体重・年齢から出す', () => {
  // 70 × 1.0 × 0.60 = 42 → 5kg 刻みで 40
  assert.equal(initialWeight(profile(), null, legPress), 40)
  // 2.5kg 刻みなら 40.0（42 を切り下げ）
  assert.equal(initialWeight(profile({ increment: 2.5 }), null, legPress), 40)
  // 日ごとの体重が入っていればそちらを見る
  assert.equal(initialWeight(profile(), 60, legPress), 35)
  // 歳を重ねているぶんは控える。70 × 0.85 × 0.6 = 35.7 → 35
  assert.equal(initialWeight(profile({ age: 65 }), null, legPress), 35)
  // 自重・有酸素には重量が無い
  assert.equal(initialWeight(profile(), null, abBench), null)
  assert.equal(initialWeight(profile(), null, cardio), null)
})

test('前回が無ければ初回の見積もりを出す', () => {
  const planned = planExercise(legPress, profile(), null, null, '2026-10-08')

  assert.equal(planned.target_weight, 40)
  assert.equal(planned.target_reps, 10)
  assert.equal(planned.target_sets, 2)
  assert.match(planned.reason, /初回負荷を推定/)
})

test('0〜1日しか空いていなければ上げない', () => {
  // 全セット達成していても上げない。回復していないため
  const planned = planExercise(
    legPress,
    profile(),
    null,
    last({}, '2026-10-07'),
    '2026-10-08'
  )

  assert.equal(planned.target_weight, 40)
  assert.equal(planned.target_reps, 10)
  assert.match(planned.reason, /0〜1日/)
})

test('全セット達成なら回数を1つ増やす', () => {
  const planned = planExercise(legPress, profile(), null, last(), '2026-10-08')

  assert.equal(planned.target_weight, 40)
  assert.equal(planned.target_reps, 11)
  assert.match(planned.reason, /目標回数\+1/)
})

test('12回まで来たら重量を1段階上げ、8回に戻す', () => {
  const planned = planExercise(
    legPress,
    profile(),
    null,
    last({ target_reps: 12, actual_reps: [12, 12] }),
    '2026-10-08'
  )

  assert.equal(planned.target_weight, 45)
  assert.equal(planned.target_reps, 8)
  assert.match(planned.reason, /重量\+1段階/)
})

test('きつかった日は達成でも上げない', () => {
  for (const effort of ['hard', 'max']) {
    const planned = planExercise(legPress, profile(), null, last({ effort }), '2026-10-08')

    assert.equal(planned.target_weight, 40)
    assert.equal(planned.target_reps, 10)
    assert.match(planned.reason, /高強度/)
  }
})

test('達成率が8割を切ったら重量を1段階落とす', () => {
  // 10回のつもりが 7回。ceil(10 × 0.8) = 8 に届かない
  const planned = planExercise(
    legPress,
    profile(),
    null,
    last({ actual_reps: [10, 7] }),
    '2026-10-08'
  )

  assert.equal(planned.target_weight, 35)
  assert.match(planned.reason, /1段階低減/)
})

test('達成は一番少なかったセットで見る', () => {
  // 1セット目だけ達成しても上げない。最後が落ちた日を達成にすると続かない
  const planned = planExercise(
    legPress,
    profile(),
    null,
    last({ actual_reps: [10, 9] }),
    '2026-10-08'
  )

  assert.equal(planned.target_weight, 40)
  assert.equal(planned.target_reps, 10)
  assert.equal(planned.reason, '前回実績を維持')
})

test('間が空いたら落とす', () => {
  // 14日以上。重量を約10%
  const two = planExercise(
    legPress,
    profile(),
    null,
    last({}, '2026-09-24'),
    '2026-10-08'
  )
  assert.equal(two.target_weight, 35)
  assert.equal(two.target_reps, 10)
  assert.match(two.reason, /14日以上/)

  // 28日以上。回数も8回に戻す
  const four = planExercise(
    legPress,
    profile(),
    null,
    last({ target_reps: 12 }, '2026-09-10'),
    '2026-10-08'
  )
  assert.equal(four.target_weight, 35)
  assert.equal(four.target_reps, 8)
  assert.match(four.reason, /28日以上/)
})

test('自重は回数だけを動かす', () => {
  const first = planExercise(abBench, profile(), null, null, '2026-10-08')
  assert.equal(first.target_weight, null)
  assert.equal(first.target_reps, 10)
  assert.match(first.reason, /初回/)

  // 達成なら+1。上限は15回
  const up = planExercise(
    abBench,
    profile(),
    null,
    last({ target_weight: null, actual_reps: [10, 10] }),
    '2026-10-08'
  )
  assert.equal(up.target_reps, 11)
  assert.equal(
    planExercise(abBench, profile(), null, last({ target_reps: 15, actual_reps: [15, 15] }), '2026-10-08')
      .target_reps,
    15
  )

  // 届かなければ-1。下限は8回
  const down = planExercise(
    abBench,
    profile(),
    null,
    last({ actual_reps: [10, 7] }),
    '2026-10-08'
  )
  assert.equal(down.target_reps, 9)
  assert.equal(
    planExercise(abBench, profile(), null, last({ target_reps: 8, actual_reps: [5, 5] }), '2026-10-08')
      .target_reps,
    8
  )
})

test('有酸素は20分のまま', () => {
  const planned = planExercise(cardio, profile(), null, null, '2026-10-08')

  assert.equal(planned.target_minutes, 20)
  assert.equal(planned.target_weight, null)
  assert.equal(planText(planned), '20分')
})

test('プロフィールが無ければメニューを作らない', () => {
  assert.equal(generatePlan(null, null, new Map(), '2026-10-08'), null)

  const plan = generatePlan(profile(), null, new Map(), '2026-10-08')
  assert.equal(plan?.length, 5)
  assert.deepEqual(
    plan?.map((p) => p.exercise_id),
    ['leg_press', 'chest_press', 'lat_pull', 'ab_bench', 'cardio']
  )
})

test('直近の実績は新しい日のものを使う', () => {
  const ex = (over: Partial<WorkoutExercise>): WorkoutExercise => ({
    id: 'x',
    session_id: 's',
    user_id: 'u',
    exercise_id: 'leg_press',
    name: 'レッグプレス',
    kind: 'strength',
    target_weight: 40,
    actual_weight: 40,
    target_reps: 10,
    actual_reps: [10, 10],
    target_sets: 2,
    target_minutes: null,
    actual_minutes: null,
    effort: 'normal',
    reason: '',
    position: 0,
    created_at: '',
    ...over,
  })

  const map = lastResultsOf([
    { date: '2026-10-07', exercises: [ex({ target_weight: 45 })] },
    { date: '2026-09-01', exercises: [ex({ target_weight: 30 }), ex({ exercise_id: 'cardio' })] },
  ])

  assert.equal(map.get('leg_press')?.date, '2026-10-07')
  assert.equal(map.get('leg_press')?.exercise.target_weight, 45)
  // 新しい日に無かった種目も、古いほうから引ける
  assert.equal(map.get('cardio')?.date, '2026-09-01')
})

test('最後にやった日からの日数を文にする', () => {
  assert.equal(sinceText([], '2026-10-08'), '記録なし')
  assert.equal(sinceText([{ date: '2026-10-08' }], '2026-10-08'), '今日実施')
  assert.equal(sinceText([{ date: '2026-10-05' }, { date: '2026-09-01' }], '2026-10-08'), '3日前')
})

test('体重の推移は古い順にして、直近ぶんだけ出す', () => {
  const rows = [
    { date: '2026-10-03', weight: 70 },
    { date: '2026-10-01', weight: 71 },
    { date: '2026-10-02', weight: 70.5 },
  ]

  assert.deepEqual(
    weightTrend(rows).map((r) => r.date),
    ['2026-10-01', '2026-10-02', '2026-10-03']
  )
  assert.equal(weightTrend(rows, 2).length, 2)
  assert.equal(weightTrend(rows, 2)[0].date, '2026-10-02')
})

test('入力を確かめる', () => {
  assert.equal(rejectProfileReason({ height: '170', weight: '70', age: '35' }), null)
  assert.match(String(rejectProfileReason({ height: '10', weight: '70', age: '35' })), /身長/)
  assert.match(String(rejectProfileReason({ height: '170', weight: '0', age: '35' })), /体重/)
  assert.match(String(rejectProfileReason({ height: '170', weight: '70', age: '5' })), /年齢/)

  assert.equal(rejectSaunaReason({ sauna_minutes: '10', sets: '3' }), null)
  assert.match(String(rejectSaunaReason({ sauna_minutes: '40', sets: '3' })), /サウナ時間/)
  assert.match(String(rejectSaunaReason({ sauna_minutes: '10', sets: '0' })), /セット数/)
})
