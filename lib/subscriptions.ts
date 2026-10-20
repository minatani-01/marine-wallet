/**
 * サブスクの管理（0065 / 0066 / 0073）。
 *
 * 毎月いくら出ていくかと、次にいつ落ちるかを出す。止めたものも消さずに
 * 残すので、「前に解約したはず」を後から確かめられる。
 *
 * 周期は「数」と「単位（週・月・年）」で持つ。月数だけでは週ぎめのものが
 * 入らない。1週間は月の長さで変わらないので、月数に直すと必ずずれる
 * （2週間ごとを0.46か月として持っても、支払日は結局日で数え直す）。
 * 単位ごとに数え方が違う（週は日で足す、月と年は月で足して無い日を末日に
 * 寄せる）ので、入れてもらったまま持つ。
 *
 * 入れてもらうのは契約日（anchor_on）。支払日はそこから周期ぶんずつ
 * 進めて出す。契約した日なら調べずに書けるし、「毎月N日」の持ち方では
 * 3か月ごとのように「どの月か」まで要るものを表せない。
 *
 * ここは純関数にしてある。DB も時計も触らないので、テストで確かめられる。
 * 日付は日本時間の 'YYYY-MM-DD' で受け渡す。
 */

/** 周期の単位。週ぎめ・月ぎめ・年ぎめのどれもある */
export type IntervalUnit = 'week' | 'month' | 'year'

/** 単位の見出し。画面の切り替えに使う */
export const INTERVAL_UNITS = [
  { id: 'week', label: '週' },
  { id: 'month', label: '月' },
  { id: 'year', label: '年' },
] as const satisfies readonly { id: IntervalUnit; label: string }[]

/**
 * 単位ごとの上限。
 *
 * どれも5年ぶんに当たるところで止める。それを越える間隔は、サブスクとしては
 * 考えにくい。週だけ52（1年ぶん）にしてあるのは、週ぎめで何年も先を
 * 指すものが無いうえ、「104週間ごと」と書かれても長さが掴めないため。
 */
export const MAX_INTERVAL_COUNTS = { week: 52, month: 60, year: 5 } as const

export function maxIntervalCount(unit: IntervalUnit): number {
  return MAX_INTERVAL_COUNTS[unit]
}

/** 知らない値なら月ぎめに戻す。DB から来た文字をそのまま信じない */
export function toIntervalUnit(value: string | null | undefined): IntervalUnit {
  return value === 'week' || value === 'year' ? value : 'month'
}

/** 周期だけ。画面からは行をそのまま渡せる */
export type Interval = {
  interval_unit: IntervalUnit
  /** 何周期ごとか。2 と week なら2週間ごと */
  interval_count: number
}

/** ジャンル。決め打ちにせず、書いたものが増える */
export const SUB_CATEGORIES = [
  '動画',
  '音楽',
  '読書',
  'ゲーム',
  '仕事',
  '生活',
  '美容',
  '治療',
  '保険',
  '通信',
  'その他',
] as const

export const DEFAULT_SUB_CATEGORY = 'その他'

/**
 * ジャンルを並べる順。
 *
 * 決まった順に並べる。使った順で出すと、前に開いたときと位置が変わり、
 * 目で探し直すことになる。
 *
 * 順番は SUB_CATEGORIES のとおり。自分で書いたものはそのうしろ、
 * 「その他」は最後。どれにも当てはまらなかったときの逃げ場なので、
 * 先に目に入ると、ちゃんとしたジャンルがあっても押してしまう。
 */
export function sortCategories(items: string[]): string[] {
  const known = SUB_CATEGORIES.filter((c) => c !== DEFAULT_SUB_CATEGORY)
  const unique = [...new Set(items)]

  return [
    ...known.filter((c) => unique.includes(c)),
    ...unique
      .filter((c) => c !== DEFAULT_SUB_CATEGORY && !known.includes(c as (typeof known)[number]))
      .sort((a, b) => a.localeCompare(b, 'ja')),
    ...(unique.includes(DEFAULT_SUB_CATEGORY) ? [DEFAULT_SUB_CATEGORY] : []),
  ]
}

/** 計算に要るところだけ。画面からは行をそのまま渡せる */
export type Billable = Interval & {
  amount: number
  /** 契約日。ここを起点に周期ぶんずつ進めて支払日を出す */
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

/** その月の末日か。2月28日（平年）も末日として扱う */
export function isMonthEnd(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number)
  return d === daysInMonth(y, m)
}

/**
 * 日を足す。週ぎめを数えるのに使う。
 *
 * 1週間は月の長さで変わらないので、週は日で足すのが正しい。月で足すと
 * 2月のぶんだけ早まる。
 */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d + days))
  return dateText(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate())
}

/**
 * 月を足す。
 *
 * 起点が末日なら、進めた先でも末日にする。2月28日の翌月は3月31日、
 * 4月30日の翌月は5月31日。月末締めのものを「28日」「30日」として
 * 持つと、短い月のぶんだけ毎回手前にずれていく。
 *
 * 末日でなければ、無い日だけ末日に寄せる（1月31日の翌月は2月28日）。
 * そこからさらに進めるときも、必ず起点から数え直す。前の結果に足して
 * いくと、寄せたぶんが積もって 1/31→4/30→7/30 のようにずれていく。
 */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  const last = daysInMonth(year, month)
  return dateText(year, month, isMonthEnd(date) ? last : Math.min(d, last))
}

/** 1以上の整数に直す。画面から来た数をそのまま計算に入れない */
function safeCount(count: number): number {
  return Math.max(1, Math.round(count || 1))
}

/**
 * 起点から n 周期ぶん進めた日。
 *
 * 単位で数え方を変える。週は日で足し、月と年は月で足して末日に寄せる。
 * いつも起点から数えるので、寄せたぶんが積もらない。
 */
export function addIntervals(anchor: string, interval: Interval, steps: number): string {
  const count = safeCount(interval.interval_count)
  if (interval.interval_unit === 'week') return addDays(anchor, steps * count * 7)
  const months = interval.interval_unit === 'year' ? count * 12 : count
  return addMonths(anchor, steps * months)
}

/** 毎月ぴったりか。画面で「月あたり」を添えるかどうかに使う */
export function isMonthly(interval: Interval): boolean {
  return interval.interval_unit === 'month' && safeCount(interval.interval_count) === 1
}

/**
 * 1年に何回落ちるか。
 *
 * 週ぎめは1年を52週として数える。実際は52.18週あるが、週あたりの額を
 * 比べるのに小数2桁ぶんの差は効かない。
 */
function timesPerYear(interval: Interval): number {
  const count = safeCount(interval.interval_count)
  if (interval.interval_unit === 'week') return 52 / count
  if (interval.interval_unit === 'year') return 1 / count
  return 12 / count
}

/** 1年あたりの額。長さの違うものを並べて比べられるようにする */
export function yearlyCost(sub: Billable): number {
  return Math.round(sub.amount * timesPerYear(sub))
}

/** ひと月あたりの額。合計も金額順もこれで出すので、年払いが下に沈まない */
export function monthlyCost(sub: Billable): number {
  return Math.round((sub.amount * timesPerYear(sub)) / 12)
}

/**
 * 次に落ちる日。
 *
 * 契約日から周期ぶんずつ進めて、今日以降で最初に来るものを返す。
 * 今日がその日なら「今日」。契約日がこれから先なら、その日そのもの。
 */
export function nextPayment(sub: Billable, today: string): string {
  const anchor = sub.anchor_on
  if (!anchor) return today
  if (anchor >= today) return anchor

  // 当たりを付けてから1周期ずつ合わせる。月ぎめは日の大小があるので、
  // 割り算だけでは1周期ぶんずれることがある
  let steps = Math.max(0, Math.floor(guessSteps(sub, anchor, today)))

  let date = addIntervals(anchor, sub, steps)
  while (date < today) {
    steps += 1
    date = addIntervals(anchor, sub, steps)
  }
  return date
}

/** 何周期ぶん過ぎているかの当たり。足りなければ nextPayment が足す */
function guessSteps(interval: Interval, anchor: string, today: string): number {
  const count = safeCount(interval.interval_count)
  if (interval.interval_unit === 'week') {
    return daysUntil(today, anchor) / (count * 7)
  }
  const months = interval.interval_unit === 'year' ? count * 12 : count
  const [ay, am] = anchor.split('-').map(Number)
  const [ty, tm] = today.split('-').map(Number)
  return (ty * 12 + tm - (ay * 12 + am)) / months
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

/**
 * 'YYYY-MM-DD' → 'YYYY/M/D'。
 *
 * 年まで出す。1年以上先の支払日を 'M/D' で出すと、今年の話に見える。
 */
export function fullDayText(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${y}/${m}/${d}`
}

/**
 * 周期の見出し。
 *
 * よく使うものには名前を付ける。「1か月ごと」より「毎月」、
 * 「6か月ごと」より「半年ごと」のほうが、読んですぐ長さが掴める。
 */
export function intervalLabel(interval: Interval): string {
  const count = safeCount(interval.interval_count)
  if (interval.interval_unit === 'week') {
    return count === 1 ? '毎週' : `${count}週間ごと`
  }
  if (interval.interval_unit === 'year') {
    return count === 1 ? '毎年' : `${count}年ごと`
  }
  if (count === 1) return '毎月'
  if (count === 6) return '半年ごと'
  if (count === 12) return '毎年'
  return `${count}か月ごと`
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

/** 並べ方。見たい目的がそのつど変わるので、選べるようにしてある */
export const SUB_SORTS = [
  { id: 'due', label: '支払日' },
  { id: 'cost', label: '金額' },
  { id: 'category', label: 'ジャンル' },
] as const

export type SubSort = (typeof SUB_SORTS)[number]['id']

export const DEFAULT_SUB_SORT: SubSort = 'due'

/** 覚えておいた並べ方。知らない値なら既定に戻す */
export function toSubSort(value: string | null): SubSort {
  return SUB_SORTS.some((sort) => sort.id === value) ? (value as SubSort) : DEFAULT_SUB_SORT
}

/**
 * 並べ替える。
 *
 * 支払日順: 次に落ちる日が近い順。「今月もう落ちたか」を追うとき。
 * 金額順: ひと月あたりが高い順。「何に一番払っているか」を見るとき。
 *         週払いも年払いも月額に直して比べるので、並びが外れない。
 * ジャンル順: ジャンルの決まった並びでまとめ、中は金額順。
 *
 * どれも最後は名前で決める。並びが毎回変わると、同じ場所を探せない。
 */
export function sortSubs<T extends Billable & { name: string; category: string }>(
  subs: T[],
  today: string,
  by: SubSort
): T[] {
  if (by === 'due') return sortByNext(subs, today)

  const order = sortCategories(subs.map((sub) => sub.category))

  return [...subs].sort((a, b) => {
    if (by === 'category') {
      const rank = order.indexOf(a.category) - order.indexOf(b.category)
      if (rank !== 0) return rank
    }
    const cost = monthlyCost(b) - monthlyCost(a)
    if (cost !== 0) return cost
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
    .filter((share) => share.monthly > 0)
    .sort((a, b) =>
      b.monthly !== a.monthly ? b.monthly - a.monthly : a.category.localeCompare(b.category, 'ja')
    )
}

/** 内訳の色。順番に当てる。隣り合う色が似ていると、帯と名前を結べない */
export const SHARE_COLORS = [
  '#22d3ee',
  '#2dd4bf',
  '#7dd3fc',
  '#f0b840',
  '#a78bfa',
  '#94a3b8',
] as const

/** まとめたときの名前 */
export const SHARE_REST = 'ほか'

export type Share = { category: string; monthly: number; percent: number }

/**
 * 内訳を上から数件にまとめる。
 *
 * ジャンルが増えると、1%に満たないものまで並んで読めなくなる。
 * 多い順に max 件まで出し、残りは「ほか」に足す。
 *
 * 割合も付ける。帯の長さだけでは、1位が8割なのか6割なのかが読めない。
 * 0%にはしない。出ているのに0と書くと、無いのかと思う。
 */
export function topShares(items: { category: string; monthly: number }[], max = 5): Share[] {
  const total = items.reduce((sum, item) => sum + item.monthly, 0)
  if (total <= 0) return []

  const head = items.slice(0, max)
  const rest = items.slice(max).reduce((sum, item) => sum + item.monthly, 0)
  const shown = rest > 0 ? [...head, { category: SHARE_REST, monthly: rest }] : head

  return shown.map((item) => ({
    ...item,
    percent: Math.max(1, Math.round((item.monthly / total) * 100)),
  }))
}

/** 単位の呼び名。入力を直してもらうときの文に使う */
const UNIT_TEXT: Record<IntervalUnit, string> = { week: '週間', month: 'か月', year: '年' }

/** 入力を確かめる。駄目なら理由を返す */
export function rejectReason(input: {
  name: string
  amount: string
  interval_unit: string
  interval_count: string
  anchor_on: string
  url: string
}): string | null {
  if (!input.name.trim()) return 'サービス名を入れてください'

  const amount = Number(input.amount)
  if (!Number.isFinite(amount) || amount < 0) return '金額を正しく入れてください'

  const unit = INTERVAL_UNITS.find((item) => item.id === input.interval_unit)?.id
  if (!unit) return '支払い周期の単位を選んでください'

  const max = maxIntervalCount(unit)
  const count = Number(input.interval_count)
  if (!Number.isInteger(count) || count < 1 || count > max) {
    return `周期は1〜${max}${UNIT_TEXT[unit]}で入れてください`
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.anchor_on)) return '契約日を選んでください'

  const url = input.url.trim()
  if (url && !/^https?:\/\//i.test(url)) return '解約ページは http:// か https:// から入れてください'

  return null
}
