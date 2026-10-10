import type { BodyProfile, WorkoutExercise } from '@/types'

/**
 * からだの記録（RE:FORM / 0064）の決め事。
 *
 * もとは Google Apps Script のアプリで、スプレッドシートを正本にしていた。
 * 負荷の決め方はそちらから丸ごと移してある。数字を変えると、これまでの
 * 記録の続きとして読めなくなるので、係数も文言もそのままにした。
 *
 * ここは純関数にしてある。DB も時計も触らないので、テストで確かめられる。
 * 「なぜその重量なのか」を後から説明できることが、この機能のいちばん大事な
 * ところなので、規則はすべてテストで固定している。
 */

export type ExerciseKind = 'strength' | 'bodyweight' | 'cardio'

export type Exercise = {
  id: string
  name: string
  kind: ExerciseKind
  /** 負荷計算用体重にかける係数（strength のみ） */
  coef?: number
  baseReps?: number
  baseSets?: number
  /** 有酸素の基本の分（cardio のみ） */
  minutes?: number
}

/**
 * マシンの種目。chocoZAP に置いてあるものに合わせてある。
 *
 * 並びも変えない。毎回同じ順で回るほうが、やり忘れに気づける。
 */
export const EXERCISES: Exercise[] = [
  { id: 'leg_press', name: 'レッグプレス', kind: 'strength', coef: 0.6, baseReps: 10, baseSets: 2 },
  {
    id: 'chest_press',
    name: 'チェストプレス',
    kind: 'strength',
    coef: 0.25,
    baseReps: 10,
    baseSets: 2,
  },
  {
    id: 'lat_pull',
    name: 'ラットプルダウン',
    kind: 'strength',
    coef: 0.25,
    baseReps: 10,
    baseSets: 2,
  },
  { id: 'ab_bench', name: 'アブベンチ', kind: 'bodyweight', baseReps: 10, baseSets: 2 },
  { id: 'cardio', name: 'トレッドミル / バイク', kind: 'cardio', minutes: 20 },
]

/** 目的。負荷の決め方は今のところ変えていない。記録として残すだけ */
export const GOALS = [
  { id: 'diet', label: 'ダイエット' },
  { id: 'muscle', label: '筋力・筋肉' },
  { id: 'fitness', label: '体力向上' },
  { id: 'health', label: '健康維持' },
] as const

/** 体感。次回の負荷を上げるかどうかの判断に使う */
export const EFFORTS = [
  { id: 'easy', label: '余裕' },
  { id: 'normal', label: '普通' },
  { id: 'hard', label: 'きつい' },
  { id: 'max', label: '限界' },
] as const

export type Effort = (typeof EFFORTS)[number]['id']

/** 体感の見出し。履歴に出す */
export function effortLabel(effort: string): string {
  return EFFORTS.find((e) => e.id === effort)?.label ?? effort
}

/** マシンの重量の刻み。置いてある機械によって変わる */
export const INCREMENTS = [5, 2.5] as const

/** フリーウェイトの種目。器具ごとにまとめる */
export const FREE_WEIGHT_GROUPS = [
  {
    label: 'ダンベル',
    items: [
      'ダンベルカール',
      'ハンマーカール',
      'ダンベルショルダープレス',
      'ダンベルベンチプレス',
      'ダンベルフライ',
      'ワンハンドダンベルロウ',
      'サイドレイズ',
      'フロントレイズ',
      'トライセプスエクステンション',
      'ゴブレットスクワット',
      'ダンベルスクワット',
      'ダンベルランジ',
      'ダンベル・ルーマニアンデッドリフト',
    ],
  },
  {
    label: 'バーベル',
    items: [
      'ベンチプレス',
      'バーベルスクワット',
      'デッドリフト',
      'バーベルロウ',
      'オーバーヘッドプレス',
    ],
  },
  { label: 'その他', items: ['ケトルベルスイング', 'ケトルベルスクワット'] },
]

export const EQUIPMENTS = ['ダンベル', 'バーベル', 'ケトルベル', '自重・その他'] as const

export const SAUNA_KINDS = [
  'ドライサウナ',
  'フィンランド式',
  'スチームサウナ',
  'ミストサウナ',
  '遠赤外線・赤外線',
  'その他',
] as const

export const COOLING_METHODS = [
  '水風呂',
  '冷水シャワー',
  '常温シャワー',
  '外気浴・自然冷却',
  'なし',
] as const

/** 終わったときの体調。無理をした日が後から分かるように残す */
export const SAUNA_CONDITIONS = [
  '問題なし',
  'かなり熱い',
  '軽いめまい・ふらつき',
  '頭痛・吐き気',
  '動悸・息苦しさ',
] as const

export const HAIR_PARTS = ['ヒゲ', '顔', '腕', 'ワキ', '胸・腹', '脚', 'その他'] as const
export const HAIR_LEVELS = ['1', '2', '3', '4', '5', ''] as const
export const SKIN_STATES = ['問題なし', 'やや赤み', '刺激あり'] as const
export const ESTHETIC_PARTS = ['腹部', '太もも', 'お尻', '腕', 'ふくらはぎ', '顔・首'] as const

/** ケアの種別。3つを1枚の表に入れてある（0064） */
export const CARE_KINDS = [
  { id: 'hair', label: '脱毛' },
  { id: 'esthetic', label: 'エステ' },
  { id: 'whitening', label: 'ホワイトニング' },
] as const

export type CareKind = (typeof CARE_KINDS)[number]['id']

// --------------------------------------------------------------- 計算 ----

/**
 * 年齢による係数。
 *
 * 初回の重量を安全側に寄せるためのもの。筋力の測定ではないので、
 * 歳が上なら控えめに始める、という以上の意味は持たせていない。
 */
export function ageFactor(age: number): number {
  if (age < 40) return 1
  if (age < 50) return 0.95
  if (age < 60) return 0.9
  if (age < 70) return 0.85
  return 0.75
}

/** 刻みに切り下げる。0kg にはしない（最低で1段階ぶんは持つ） */
export function floorTo(value: number, step: number): number {
  return Math.max(step, Math.floor(value / step) * step)
}

/** BMI。身長が無ければ null */
export function bmi(height: number, weight: number): number | null {
  if (!(height > 0)) return null
  const m = height / 100
  return weight / (m * m)
}

/** 'YYYY-MM-DD' の間の日数。月をまたいでも時差でずれないよう UTC で引く */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const a = Date.UTC(fy, (fm ?? 1) - 1, fd ?? 1)
  const b = Date.UTC(ty, (tm ?? 1) - 1, td ?? 1)
  return Math.floor((b - a) / 86_400_000)
}

/** 最後にやった日。無ければ null */
export function latestDate(rows: { date: string }[]): string | null {
  return rows.reduce<string | null>((max, row) => (!max || row.date > max ? row.date : max), null)
}

/** 「今日実施」「3日前」。まだ無ければ「記録なし」 */
export function sinceText(rows: { date: string }[], today: string): string {
  const date = latestDate(rows)
  if (!date) return '記録なし'
  const gap = daysBetween(date, today)
  if (gap <= 0) return '今日実施'
  return `${gap}日前`
}

/**
 * 負荷計算用の体重。
 *
 * 実体重と「BMI25 相当の体重」の小さいほうを使う。体重が重いほど
 * 初回から重い設定になるのを防ぐためで、元のアプリの決め方をそのまま
 * 引いている。
 */
export function effectiveWeight(height: number, weight: number): number {
  const m = height / 100
  return Math.min(weight, 25 * m * m)
}

/** 初回の重量。身長・体重・年齢から安全側に見積もる */
export function initialWeight(
  profile: BodyProfile,
  latestWeight: number | null,
  exercise: Exercise
): number | null {
  if (exercise.kind !== 'strength' || !exercise.coef) return null
  const eff = effectiveWeight(profile.height, latestWeight ?? profile.weight)
  return floorTo(eff * ageFactor(profile.age) * exercise.coef, profile.increment || 5)
}

/** 直近の実績。その種目を最後にやったときの1件 */
export type LastResult = {
  date: string
  exercise: Pick<
    WorkoutExercise,
    'target_weight' | 'actual_weight' | 'target_reps' | 'actual_reps' | 'target_sets' | 'effort'
  >
}

export type PlannedExercise = {
  exercise_id: string
  name: string
  kind: ExerciseKind
  target_weight: number | null
  target_reps: number | null
  target_sets: number | null
  target_minutes: number | null
  /** その負荷にした理由。画面にそのまま出す */
  reason: string
}

/**
 * 今日ぶんの1種目を決める。
 *
 * 決め方（元のアプリのまま）。
 *
 *   前回が無い   身長・体重・年齢から見積もる
 *   0〜1日       上げない。間が空いていないので回復していない
 *   14日以上     重量を約10%落とす
 *   28日以上     重量を約10%落として回数も8回に戻す
 *   達成率8割未満 重量を1段階落とす
 *   全セット達成 体感が余裕か普通なら回数+1。12回まで来ていたら重量+1段階
 *
 * 達成の判定は「一番少なかったセット」で見る。最後のセットだけ落ちた日を
 * 達成にすると、次回の重量が上がって続かなくなる。
 */
export function planExercise(
  exercise: Exercise,
  profile: BodyProfile,
  latestWeight: number | null,
  last: LastResult | null,
  today: string
): PlannedExercise {
  const base = {
    exercise_id: exercise.id,
    name: exercise.name,
    kind: exercise.kind,
    target_weight: null as number | null,
    target_reps: null as number | null,
    target_sets: null as number | null,
    target_minutes: null as number | null,
  }

  if (exercise.kind === 'cardio') {
    return { ...base, target_minutes: exercise.minutes ?? 20, reason: '有酸素運動の基本枠' }
  }

  const step = profile.increment || 5

  if (exercise.kind === 'bodyweight') {
    if (!last) {
      return {
        ...base,
        target_reps: exercise.baseReps ?? 10,
        target_sets: exercise.baseSets ?? 2,
        reason: '初回：安全側の10回×2セット',
      }
    }

    const interval = daysBetween(last.date, today)
    const done = last.exercise.actual_reps ?? []
    const min = done.length > 0 ? Math.min(...done) : 0
    let reps = last.exercise.target_reps ?? 10
    const sets = last.exercise.target_sets ?? 2
    let reason = '前回実績を維持'

    if (interval >= 28) {
      reps = Math.max(8, Math.floor(reps * 0.9))
      reason = '28日以上空いたため回数を約10%低減'
    } else if (min >= reps && (last.exercise.effort === 'easy' || last.exercise.effort === 'normal')) {
      reps = Math.min(15, reps + 1)
      reason = '前回全セット達成のため+1回'
    } else if (min < Math.ceil(reps * 0.8)) {
      reps = Math.max(8, reps - 1)
      reason = '前回達成率80%未満のため-1回'
    }

    return { ...base, target_reps: reps, target_sets: sets, reason }
  }

  if (!last) {
    return {
      ...base,
      target_weight: initialWeight(profile, latestWeight, exercise),
      target_reps: 10,
      target_sets: 2,
      reason: '身長・体重・年齢から初回負荷を推定',
    }
  }

  const interval = daysBetween(last.date, today)
  let weight =
    last.exercise.target_weight ??
    last.exercise.actual_weight ??
    initialWeight(profile, latestWeight, exercise) ??
    step
  let reps = last.exercise.target_reps ?? 10
  const sets = last.exercise.target_sets ?? 2
  const done = last.exercise.actual_reps ?? []
  const min = done.length > 0 ? Math.min(...done) : 0
  const effort = last.exercise.effort || 'normal'
  let reason = '前回実績を維持'

  if (interval <= 1) {
    reason = '前回から0〜1日のため負荷アップなし'
  } else if (interval >= 28) {
    weight = floorTo(weight * 0.9, step)
    reps = 8
    reason = '28日以上空いたため前回重量を約10%低減'
  } else if (interval >= 14) {
    weight = floorTo(weight * 0.9, step)
    reps = Math.min(reps, 10)
    reason = '14日以上空いたため負荷を約10%低減'
  } else if (min < Math.ceil(reps * 0.8)) {
    weight = Math.max(step, weight - step)
    reason = '前回達成率80%未満のため重量を1段階低減'
  } else if (min >= reps && (effort === 'easy' || effort === 'normal')) {
    if (reps < 12) {
      reps += 1
      reason = '前回全セット達成のため目標回数+1'
    } else {
      weight += step
      reps = 8
      reason = '12回を全セット達成したため重量+1段階、8回へ戻す'
    }
  } else if (min >= reps) {
    reason = '達成したが高強度だったため今回は維持'
  }

  return { ...base, target_weight: weight, target_reps: reps, target_sets: sets, reason }
}

/**
 * 今日ぶんのメニュー。
 *
 * プロフィールが無いあいだは作らない。身長・体重・年齢が無いと初回の重量を
 * 見積もれず、適当な数字を置くと危ない。
 *
 * @param lastResults 種目ごとの、最後にやったときの1件
 */
export function generatePlan(
  profile: BodyProfile | null,
  latestWeight: number | null,
  lastResults: Map<string, LastResult>,
  today: string
): PlannedExercise[] | null {
  if (!profile) return null
  return EXERCISES.map((exercise) =>
    planExercise(exercise, profile, latestWeight, lastResults.get(exercise.id) ?? null, today)
  )
}

/**
 * 済んだセッションから、種目ごとの直近の実績を引く。
 *
 * 新しい日のものを優先する。同じ日に2回やった場合は、後に入ったものが残る
 * （セッションは新しい順に渡ってくる）。
 */
export function lastResultsOf(
  sessions: { date: string; exercises: WorkoutExercise[] }[]
): Map<string, LastResult> {
  const map = new Map<string, LastResult>()
  for (const session of sessions) {
    for (const exercise of session.exercises) {
      const held = map.get(exercise.exercise_id)
      if (held && held.date >= session.date) continue
      map.set(exercise.exercise_id, { date: session.date, exercise })
    }
  }
  return map
}

/** 予定の1行。「40kg × 10回 × 2セット」「20分」 */
export function planText(planned: PlannedExercise): string {
  if (planned.kind === 'cardio') return `${planned.target_minutes}分`
  if (planned.kind === 'bodyweight') {
    return `${planned.target_reps}回 × ${planned.target_sets}セット`
  }
  return `${planned.target_weight}kg × ${planned.target_reps}回 × ${planned.target_sets}セット`
}

/** 種別の札。「筋力」「自重」「有酸素」 */
export function kindLabel(kind: ExerciseKind): string {
  if (kind === 'cardio') return '有酸素'
  if (kind === 'bodyweight') return '自重'
  return '筋力'
}

/**
 * 体重の推移。直近 n 件を古い順に返す。
 *
 * グラフは左から右へ時間が進む形にする。新しい順のまま描くと、
 * 増えているのか減っているのかが逆に見える。
 */
export function weightTrend(
  rows: { date: string; weight: number }[],
  limit = 12
): { date: string; weight: number }[] {
  return [...rows].sort((a, b) => a.date.localeCompare(b.date)).slice(-limit)
}

/** プロフィールの入力を確かめる。駄目なら理由を返す */
export function rejectProfileReason(input: {
  height: string
  weight: string
  age: string
}): string | null {
  const height = Number(input.height)
  if (!(height >= 120 && height <= 230)) return '身長を正しく入れてください（120〜230cm）'
  const weight = Number(input.weight)
  if (!(weight >= 30 && weight <= 250)) return '体重を正しく入れてください（30〜250kg）'
  const age = Number(input.age)
  if (!(age >= 18 && age <= 100)) return '年齢を正しく入れてください（18〜100）'
  return null
}

/** 体重だけの入力を確かめる */
export function rejectWeightReason(value: string): string | null {
  const weight = Number(value)
  if (!(weight >= 30 && weight <= 250)) return '体重を正しく入れてください（30〜250kg）'
  return null
}

/** サウナの入力を確かめる。元のアプリと同じ範囲にしてある */
export function rejectSaunaReason(input: { sauna_minutes: string; sets: string }): string | null {
  const minutes = Number(input.sauna_minutes)
  if (!(minutes > 0 && minutes <= 30)) return 'サウナ時間を正しく入れてください（1〜30分）'
  const sets = Number(input.sets)
  if (!(sets >= 1 && sets <= 10)) return 'セット数を正しく入れてください（1〜10）'
  return null
}

/** 空欄は null にする。0 と「入れていない」を区別する */
export function numOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const num = Number(trimmed)
  return Number.isFinite(num) ? num : null
}
