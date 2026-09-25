/**
 * オートファジー（1日のうち食べない時間を作る）の時間の扱い。
 *
 * DB も通信もしない純関数にしてある。画面でも、通知を送るサーバー側でも
 * 同じ判定を使いたい。両方に書くと、画面は「断食中」なのに通知は
 * 「食べてOK」と言う、といったずれが起きる。
 *
 * 時刻は「その日の0時から何分か」で扱う。18:00 なら 1080。
 * 日付や時差の話をここに持ち込まないためで、日本時間への読み替えは
 * 呼ぶ側（jstMinutes）でまとめてある。
 *
 * 食べてよい時間は日をまたぐ。18:00〜翌2:00 のように、終わりが始まりより
 * 小さいことがふつうにある。またぐかどうかで場合分けするのはこの中だけに
 * して、外からは「いま食べてよいか」だけを見えるようにする。
 */

/** 1日の分数 */
export const DAY_MINUTES = 24 * 60

export type Window = {
  /** 食べてよい時間の始まり 'HH:MM' */
  eat_start: string
  /** 食べてよい時間の終わり 'HH:MM' */
  eat_end: string
}

/** 既定の時間。18:00〜翌2:00 に食べ、2:00〜18:00 は食べない（16時間） */
export const DEFAULT_WINDOW: Window = { eat_start: '18:00', eat_end: '02:00' }

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

/**
 * いま食べてよい時間か。
 *
 * 始まりと終わりが同じときは、24時間ずっと食べてよいとみなす。
 * 「食べない時間が0分」のほうが、「食べてよい時間が0分」より
 * 事故が小さい。設定を触っている途中に断食が始まることがない。
 */
export function isEating(window: Window, minutes: number): boolean {
  const start = toMinutes(window.eat_start)
  const end = toMinutes(window.eat_end)
  if (start === null || end === null) return true
  if (start === end) return true

  // 日をまたがない（例 8:00〜20:00）
  if (start < end) return minutes >= start && minutes < end
  // 日をまたぐ（例 18:00〜翌2:00）
  return minutes >= start || minutes < end
}

export type Boundary = {
  /** その境目で始まるもの */
  kind: 'eat' | 'fast'
  /** 境目の時刻 'HH:MM' */
  at: string
  /** いまから何分後か（0〜1440） */
  inMinutes: number
}

/**
 * 次の境目。
 *
 * 始まりと終わりが同じ（ずっと食べてよい）ときは境目が無いので null。
 */
export function nextBoundary(window: Window, minutes: number): Boundary | null {
  const start = toMinutes(window.eat_start)
  const end = toMinutes(window.eat_end)
  if (start === null || end === null || start === end) return null

  const eating = isEating(window, minutes)
  // 食べている途中なら次は断食の始まり、そうでなければ食事の始まり
  const target = eating ? end : start
  const diff = (target - minutes + DAY_MINUTES) % DAY_MINUTES

  return {
    kind: eating ? 'fast' : 'eat',
    at: toHhmm(target),
    // ちょうど境目にいるときは「24時間後」ではなく「いま」とする
    inMinutes: diff,
  }
}

/** 食べてよい時間の長さ（分） */
export function eatingMinutes(window: Window): number | null {
  const start = toMinutes(window.eat_start)
  const end = toMinutes(window.eat_end)
  if (start === null || end === null) return null
  if (start === end) return DAY_MINUTES
  return (end - start + DAY_MINUTES) % DAY_MINUTES
}

/** 食べない時間の長さ（分） */
export function fastingMinutes(window: Window): number | null {
  const eating = eatingMinutes(window)
  return eating === null ? null : DAY_MINUTES - eating
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
  window: Window,
  minutes: number,
  windowMinutes = 5
): Boundary['kind'] | null {
  const start = toMinutes(window.eat_start)
  const end = toMinutes(window.eat_end)
  if (start === null || end === null || start === end) return null

  // 境目から何分経ったか
  const sinceEat = (minutes - start + DAY_MINUTES) % DAY_MINUTES
  const sinceFast = (minutes - end + DAY_MINUTES) % DAY_MINUTES

  if (sinceEat < windowMinutes) return 'eat'
  if (sinceFast < windowMinutes) return 'fast'
  return null
}
