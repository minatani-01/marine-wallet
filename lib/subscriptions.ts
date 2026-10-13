/**
 * サブスクの管理（0065）。
 *
 * 毎月いくら出ていくかと、次にいつ落ちるかを出す。止めたものも消さずに
 * 残すので、「前に解約したはず」を後から確かめられる。
 *
 * ここは純関数にしてある。DB も時計も触らないので、テストで確かめられる。
 * 日付は日本時間の 'YYYY-MM-DD' で受け渡す。
 */

export type Cycle = 'monthly' | 'yearly'

export const CYCLES = [
  { id: 'monthly', label: '毎月' },
  { id: 'yearly', label: '毎年' },
] as const

/** ジャンル。決め打ちにせず、書いたものが増える */
export const SUB_CATEGORIES = [
  '動画',
  '音楽',
  '読み物',
  'ゲーム',
  '仕事',
  '生活',
  '通信',
  'その他',
] as const

export const DEFAULT_SUB_CATEGORY = 'その他'

/** 計算に要るところだけ。画面からは行をそのまま渡せる */
export type Billable = {
  amount: number
  cycle: string
  /** 毎月なら日、毎年なら月の中の日 */
  billing_day: number
  /** 毎年のときだけ使う（1〜12） */
  billing_month: number | null
}

/** その月の日数。月末の指定を丸めるのに使う */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** 'YYYY-MM-DD' に組み立てる */
function dateText(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * ひと月あたりの額。
 *
 * 年払いは12で割る。月払いと並べて比べられないと、どれが重いのか分からない。
 * 円に小数は無いので丸める。
 */
export function monthlyCost(sub: Billable): number {
  return sub.cycle === 'yearly' ? Math.round(sub.amount / 12) : sub.amount
}

/** 1年あたりの額 */
export function yearlyCost(sub: Billable): number {
  return sub.cycle === 'yearly' ? sub.amount : sub.amount * 12
}

/**
 * 次に落ちる日。
 *
 * 31日を指定していても、2月や30日までの月では末日に寄せる。カードの
 * 引き落としと同じ考え方で、無い日は繰り上げない（翌月1日にしない）。
 *
 * 今日がその日なら「今日」を返す。過ぎていれば次の周期へ送る。
 */
export function nextPayment(sub: Billable, today: string): string {
  const [y, m, d] = today.split('-').map(Number)

  if (sub.cycle === 'yearly') {
    const month = sub.billing_month ?? 1
    const inYear = (year: number) => dateText(year, month, Math.min(sub.billing_day, daysInMonth(year, month)))
    const thisYear = inYear(y)
    return thisYear >= today ? thisYear : inYear(y + 1)
  }

  const inMonth = (year: number, month: number) =>
    dateText(year, month, Math.min(sub.billing_day, daysInMonth(year, month)))

  const thisMonth = inMonth(y, m)
  if (thisMonth >= today) return thisMonth
  return m === 12 ? inMonth(y + 1, 1) : inMonth(y, m + 1)
}

/** 'YYYY-MM-DD' の間の日数。月をまたいでも時差でずれないよう UTC で引く */
export function daysUntil(date: string, today: string): number {
  const [ty, tm, td] = today.split('-').map(Number)
  const [dy, dm, dd] = date.split('-').map(Number)
  return Math.round((Date.UTC(dy, dm - 1, dd) - Date.UTC(ty, tm - 1, td)) / 86_400_000)
}

/** 「今日」「明日」「3日後」。先の話なので、過ぎた日は想定しない */
export function untilText(days: number): string {
  if (days <= 0) return '今日'
  if (days === 1) return '明日'
  return `${days}日後`
}

/** 'YYYY-MM-DD' → 'M/D' */
export function dayText(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return `${m}/${d}`
}

/** 周期の見出し */
export function cycleLabel(cycle: string): string {
  return CYCLES.find((c) => c.id === cycle)?.label ?? cycle
}

/**
 * 次に落ちる順に並べる。
 *
 * 同じ日なら高い順。同じ日に複数あるとき、効くのは大きいほうである。
 */
export function sortByNext<T extends Billable & { name: string }>(subs: T[], today: string): T[] {
  return [...subs].sort((a, b) => {
    const left = nextPayment(a, today)
    const right = nextPayment(b, today)
    if (left !== right) return left.localeCompare(right)
    if (a.amount !== b.amount) return b.amount - a.amount
    return a.name.localeCompare(b.name, 'ja')
  })
}

/** 使っているものの合計。止めたものは数えない */
export function totals(subs: (Billable & { active: boolean })[]): {
  monthly: number
  yearly: number
  count: number
} {
  const living = subs.filter((sub) => sub.active)
  return {
    monthly: living.reduce((sum, sub) => sum + monthlyCost(sub), 0),
    yearly: living.reduce((sum, sub) => sum + yearlyCost(sub), 0),
    count: living.length,
  }
}

/** ジャンルごとのひと月あたり。多い順に返す */
export function byCategory(
  subs: (Billable & { active: boolean; category: string })[]
): { category: string; monthly: number }[] {
  const sums = new Map<string, number>()
  for (const sub of subs) {
    if (!sub.active) continue
    sums.set(sub.category, (sums.get(sub.category) ?? 0) + monthlyCost(sub))
  }
  return [...sums.entries()]
    .map(([category, monthly]) => ({ category, monthly }))
    .sort((a, b) => (b.monthly !== a.monthly ? b.monthly - a.monthly : a.category.localeCompare(b.category, 'ja')))
}

/** 入力を確かめる。駄目なら理由を返す */
export function rejectReason(input: {
  name: string
  amount: string
  billing_day: string
  cycle: string
  billing_month: string
  url: string
}): string | null {
  if (!input.name.trim()) return 'サービス名を入れてください'

  const amount = Number(input.amount)
  if (!Number.isFinite(amount) || amount < 0) return '金額を正しく入れてください'

  const day = Number(input.billing_day)
  if (!Number.isInteger(day) || day < 1 || day > 31) return '支払日は1〜31で入れてください'

  if (input.cycle === 'yearly') {
    const month = Number(input.billing_month)
    if (!Number.isInteger(month) || month < 1 || month > 12) return '支払月は1〜12で入れてください'
  }

  const url = input.url.trim()
  if (url && !/^https?:\/\//i.test(url)) return '解約ページは http:// か https:// から入れてください'

  return null
}
