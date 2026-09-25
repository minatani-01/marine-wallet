/**
 * オートファジー（1日のうち食べない時間を作る）の時間の扱い。
 *
 * DB も通信もしない純関数にしてある。画面でも、通知を送るサーバー側でも
 * 同じ判定を使いたい。両方に書くと、画面は「断食中」なのに通知は
 * 「食べてOK」と言う、といったずれが起きる。
 *
 * 持つのは「食べない時間の始まり」と「その長さ」の2つだけにする。
 * 終わりは足せば出るので、入れてもらう必要がない。2つ入れさせると、
 * 8時間のつもりが7時間になっている、といった食い違いが起きる。
 *
 * 時刻は「その日の0時から何分か」で扱う。18:00 なら 1080。
 * 日付や時差の話をここに持ち込まないためで、日本時間への読み替えは
 * 呼ぶ側（jstMinutes）でまとめてある。
 *
 * 食べない時間は日をまたぐ。2:00 から16時間なら翌18:00 までで、
 * 日付は変わらないが、22:00 から8時間なら翌6:00 になる。またぐかどうかで
 * 場合分けするのはこの中だけにして、外からは「いま食べてよいか」だけを
 * 見えるようにする。
 */

/** 1日の分数 */
export const DAY_MINUTES = 24 * 60

export type Plan = {
  /** 食べない時間の始まり 'HH:MM' */
  fast_start: string
  /** 食べない時間の長さ（時間）。1〜23 */
  fast_hours: number
}

/**
 * 既定。2:00 から16時間食べない（＝18:00〜翌2:00 に食べる）。
 *
 * 16時間はオートファジーでよく言われる長さで、夕食を普通にとれる。
 */
export const DEFAULT_PLAN: Plan = { fast_start: '02:00', fast_hours: 16 }

/**
 * 選べる長さ。細かく刻んでも押し分けられない。
 *
 * 16時間を真ん中に、前後を1つずつ。12時間では食べない時間が半分になり、
 * オートファジーとしては短い。
 */
export const FAST_HOURS_CHOICES = [14, 16, 18] as const

/** 'HH:MM' → 0時からの分数。読めなければ null */
export function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm)
  if (!m) return null
  const hours = Number(m[1])
  const mins = Number(m[2])
  if (hours > 23 || mins > 59) return null
  return hours * 60 + mins
}

/** 0時からの分数 → 'HH:MM' */
export function toHhmm(minutes: number): string {
  const wrapped = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  const hours = Math.floor(wrapped / 60)
  const mins = wrapped % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

/** その日時の、日本時間での0時からの分数 */
export function jstMinutes(now: Date): number {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return jst.getUTCHours() * 60 + jst.getUTCMinutes()
}

/** 長さが使える値か。0以下や24以上だと「ずっと」になり、境目が無くなる */
function validHours(hours: number): boolean {
  return Number.isFinite(hours) && hours > 0 && hours < 24
}

/** 食べない時間が終わる時刻（＝食べてよくなる時刻）。0時からの分数 */
export function fastEndMinutes(plan: Plan): number | null {
  const start = toMinutes(plan.fast_start)
  if (start === null || !validHours(plan.fast_hours)) return null
  return (start + Math.round(plan.fast_hours * 60)) % DAY_MINUTES
}

/** 食べてよくなる時刻 'HH:MM' */
export function fastEnd(plan: Plan): string | null {
  const end = fastEndMinutes(plan)
  return end === null ? null : toHhmm(end)
}

/** 食べてよい時間の長さ（分） */
export function eatingMinutes(plan: Plan): number | null {
  if (!validHours(plan.fast_hours)) return null
  return DAY_MINUTES - Math.round(plan.fast_hours * 60)
}

/** 食べない時間の長さ（分） */
export function fastingMinutes(plan: Plan): number | null {
  if (!validHours(plan.fast_hours)) return null
  return Math.round(plan.fast_hours * 60)
}

/**
 * いま食べてはいけない時間か。
 *
 * 始まりちょうどは、もう食べない時間に入っている。終わりちょうどは
 * もう食べてよい。どちらかに寄せないと、境目の1分が宙に浮く。
 */
export function isFasting(plan: Plan, minutes: number): boolean {
  const start = toMinutes(plan.fast_start)
  const end = fastEndMinutes(plan)
  if (start === null || end === null) return false

  // 日をまたがない（例 2:00 から16時間 → 18:00）
  if (start < end) return minutes >= start && minutes < end
  // 日をまたぐ（例 22:00 から8時間 → 翌6:00）
  return minutes >= start || minutes < end
}

export type Boundary = {
  /** その境目で始まるもの。fast=食べない時間 / eat=食べてよい時間 */
  kind: 'eat' | 'fast'
  /** 境目の時刻 'HH:MM' */
  at: string
  /** いまから何分後か（0〜1440） */
  inMinutes: number
}

/** 次の境目。長さが使えない値のときは null */
export function nextBoundary(plan: Plan, minutes: number): Boundary | null {
  const start = toMinutes(plan.fast_start)
  const end = fastEndMinutes(plan)
  if (start === null || end === null) return null

  const fasting = isFasting(plan, minutes)
  // 食べない時間の途中なら次は解禁、そうでなければ次は断食の始まり
  const target = fasting ? end : start

  return {
    kind: fasting ? 'eat' : 'fast',
    at: toHhmm(target),
    inMinutes: (target - minutes + DAY_MINUTES) % DAY_MINUTES,
  }
}

/**
 * 残り時間の書き方。
 *
 * 「あと3時間20分」より「3時間20分」のほうが短く、前に付ける言葉を
 * 画面側で選べる。1時間未満は分だけにする。
 */
export function spanText(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}分`
  if (mins === 0) return `${hours}時間`
  return `${hours}時間${mins}分`
}

/**
 * いま送るべき通知があるか。
 *
 * 境目をちょうど跨いだ1回だけ送りたい。通知を出す仕組みは1分ごとに
 * 見に来るので、「境目から windowMinutes 分以内」を送る対象とする。
 * 送ったかどうかは呼ぶ側が覚える（last_notified_at）。
 *
 * @param minutes いまの時刻（日本時間の0時からの分数）
 * @param windowMinutes 境目からこの分数までを「いま」とみなす
 */
export function dueBoundary(
  plan: Plan,
  minutes: number,
  windowMinutes = 5
): Boundary['kind'] | null {
  const start = toMinutes(plan.fast_start)
  const end = fastEndMinutes(plan)
  if (start === null || end === null) return null

  // 境目から何分経ったか
  const sinceFast = (minutes - start + DAY_MINUTES) % DAY_MINUTES
  const sinceEat = (minutes - end + DAY_MINUTES) % DAY_MINUTES

  if (sinceFast < windowMinutes) return 'fast'
  if (sinceEat < windowMinutes) return 'eat'
  return null
}
