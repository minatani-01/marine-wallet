import { WORKOUT_DRAFT_STORAGE_KEY } from '@/lib/constants'
import type { Effort, PlannedExercise } from '@/lib/reform'

/**
 * やりかけのワークアウト（0064）。
 *
 * 記録は「完了して保存」を押すまで DB に入れない。途中の数字を1セットずつ
 * 送ると、やめた回ぶんの空のセッションが残り、次回の負荷もそれを「前回」と
 * 見てしまう。
 *
 * かわりに端末の中へ置く。ジムで使うものなので、途中で履歴を見たり、
 * 画面を閉じたり、通知から別のアプリへ移ったりするのは普通に起きる。
 * そのたびに入れた回数が消えると付ける気が無くなる。
 *
 * 置き場は端末の中だけで、相手にも DB にも渡らない。
 */
export type WorkoutDraftExercise = {
  planned: PlannedExercise
  actual_weight: string
  /** セットごとの実施回数 */
  actual_reps: string[]
  actual_minutes: string
  effort: Effort
}

export type WorkoutDraft = {
  /** 誰のものか。端末を共有していても取り違えない */
  user_id: string
  /** いつ始めたか（YYYY-MM-DD）。日が変わったら続きとして扱わない */
  date: string
  started_at: number
  exercises: WorkoutDraftExercise[]
}

/**
 * 置いてあるものを読める形にする。駄目なら null。
 *
 * 別の人のもの、別の日のものは返さない。前の日のやりかけを「今日の記録」
 * として保存すると、やっていない日に記録が立つ。
 *
 * 純関数にしてあるので、判断の決まりをテストで確かめられる。
 */
export function pickDraft(raw: string | null, userId: string, today: string): WorkoutDraft | null {
  if (!raw) return null

  let held: unknown
  try {
    held = JSON.parse(raw)
  } catch {
    return null
  }

  if (!held || typeof held !== 'object') return null
  const draft = held as Partial<WorkoutDraft>

  if (draft.user_id !== userId) return null
  if (draft.date !== today) return null
  if (!Array.isArray(draft.exercises) || draft.exercises.length === 0) return null

  return {
    user_id: draft.user_id,
    date: draft.date,
    started_at: typeof draft.started_at === 'number' ? draft.started_at : Date.now(),
    exercises: draft.exercises,
  }
}

/** 端末から読む。localStorage が使えない環境では null（下書きを持たないだけ） */
export function loadWorkoutDraft(userId: string, today: string): WorkoutDraft | null {
  try {
    return pickDraft(window.localStorage.getItem(WORKOUT_DRAFT_STORAGE_KEY), userId, today)
  } catch {
    return null
  }
}

/** 端末へ残す。失敗しても投げない。残らないだけで、その場の入力は続けられる */
export function saveWorkoutDraft(draft: WorkoutDraft) {
  try {
    window.localStorage.setItem(WORKOUT_DRAFT_STORAGE_KEY, JSON.stringify(draft))
  } catch {
    /* 容量いっぱい・プライベートモードなど。続きの保持を諦めるだけにする */
  }
}

/** 保存できた、またはやめたとき。残しておくと次に開いたとき混ざる */
export function clearWorkoutDraft() {
  try {
    window.localStorage.removeItem(WORKOUT_DRAFT_STORAGE_KEY)
  } catch {
    /* 消せなくても、日が変わるか別の回を始めれば上書きされる */
  }
}
