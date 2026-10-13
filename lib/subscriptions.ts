/**
 * サブスクの管理（0065 / 0066）。
 *
 * 毎月いくら出ていくかと、次にいつ落ちるかを出す。止めたものも消さずに
 * 残すので、「前に解約したはず」を後から確かめられる。
 *
 * 周期は「何か月ごと」で持つ。毎月と毎年だけでは、3か月ごとや半年ごとの
 * ものが入らない。入れてもらうときは年でも月でも書けるようにして、
 * ここへ来る前に月数へ直す。「24か月ごと」では長さが掴めない。
 *
 * 支払日は日付そのもので持つ（anchor_on）。カレンダーから1回選べば、
 * あとはそこから周期ぶんずつ進める。「毎月N日」の持ち方だと、3か月ごとの
 * ように「どの月か」まで要るものを表せない。
 *
 * ここは純関数にしてある。DB も時計も触らないので、テストで確かめられる。
 * 日付は日本時間の 'YYYY-MM-DD' で受け渡す。
 */

/** よく使う周期。これ以外は数で入れてもらう */
export const INTERVALS = [
  { months: 1, label: '毎月' },
  { months: 3, label: '3か月ごと' },
  { months: 6, label: '半年ごと' },
  { months: 12, label: '毎年' },
] as const

/** 周期の上限（か月）。5年を超える間隔は、サブスクとしては考えにくい */
export const MAX_INTERVAL_MONTHS = 60

/** 周期の単位。「60か月ごと」と書かれても長さが掴めないので、年でも入れられるようにする */
export type IntervalUnit = 'month' | 'year'

/** 単位ごとの上限。年は5、月は60。どちらも 60 か月に当たる */
export function maxIntervalCount(unit: IntervalUnit): number {
  return unit === 'year' ? MAX_INTERVAL_MONTHS / 12 : MAX_INTERVAL_MONTHS
}

/** 「3」と「か月」から月数を出す */
export function toMonths(count: number, unit: IntervalUnit): number {
  return unit === 'year' ? count * 12 : count
}

/**
 * 月数を「数と単位」に割る。画面に出すときに使う。
 *
 * 12の倍数なら年にする。24を「24か月ごと」と書かれても長さが掴めない。
 * 12で割り切れない18のようなものは、月のまま出すほかない。
 */
export function splitInterval(months: number): { count: number; unit: IntervalUnit } {
  const safe = Math.max(1, Math.round(months))
  if (safe % 12 === 0) return { count: safe / 12, unit: 'year' }
  return { count: safe, unit: 'month' }
}

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
  /** 何か月ごとに落ちるか */
  interval_months: number
  /** 支払日。ここを起点に周期ぶんずつ進める */
  anchor_on: string
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
 * 月を足す。無い日は末日に寄せる。
 *
 * 1月31日の3か月後は4月30日。そこからさらに進めるときも、必ず起点から
 * 数え直す。前の結果に足していくと、末日に寄せたぶんが積もって
 * 1月31日→4月30日→7月30日のようにずれていく。
 */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  return dateText(year, month, Math.min(d, daysInMonth(year, month)))
}

/** ひと月あたりの額。周期で割って、長さの違うものを並べて比べられるようにする */
export function monthlyCost(sub: Billable): number {
  return Math.round(sub.amount / Math.max(1, sub.interval_months))
}

/** 1年あたりの額 */
export function yearlyCost(sub: Billable): number {
  return Math.round((sub.amount * 12) / Math.max(1, sub.interval_months))
}

/**
 * 次に落ちる日。
 *
 * 支払日から周期ぶんずつ進めて、今日以降で最初に来るものを返す。
 * 今日がその日なら「今日」。支払日がこれから先なら、その日そのもの。
 */
export function nextPayment(sub: Billable, today: string): string {
  const interval = Math.max(1, Math.round(sub.interval_months))
  const anchor = sub.anchor_on
  if (!anchor) return today
  if (anchor >= today) return anchor

  // 月数の差から当たりを付けてから、1周期ずつ合わせる。日の大小があるので
  // 割り算だけでは1周期ぶんずれることがある
  const [ay, am] = anchor.split('-').map(Number)
  const [ty, tm] = today.split('-').map(Number)
  const months = (ty * 12 + tm) - (ay * 12 + am)
  let steps = Math.max(0, Math.floor(months / interval))

  let date = addMonths(anchor, steps * interval)
  while (date < today) {
    steps += 1
    date = addMonths(anchor, steps * interval)
  }
  return date
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

/** 周期の見出し。よく使うものには名前を付ける */
export function intervalLabel(months: number): string {
  const known = INTERVALS.find((i) => i.months === months)
  if (known) return known.label
  if (months % 12 === 0) return `${months / 12}年ごと`
  return `${months}か月ごと`
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
    .sort((a, b) =>
      b.monthly !== a.monthly ? b.monthly - a.monthly : a.category.localeCompare(b.category, 'ja')
    )
}

/** 入力を確かめる。駄目なら理由を返す */
export function rejectReason(input: {
  name: string
  amount: string
  interval_months: string
  anchor_on: string
  url: string
}): string | null {
  if (!input.name.trim()) return 'サービス名を入れてください'

  const amount = Number(input.amount)
  if (!Number.isFinite(amount) || amount < 0) return '金額を正しく入れてください'

  const interval = Number(input.interval_months)
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL_MONTHS) {
    return `周期は1か月〜${MAX_INTERVAL_MONTHS / 12}年で入れてください`
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.anchor_on)) return '支払日を選んでください'

  const url = input.url.trim()
  if (url && !/^https?:\/\//i.test(url)) return '解約ページは http:// か https:// から入れてください'

  return null
}
