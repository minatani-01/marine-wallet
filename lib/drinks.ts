/**
 * 特製ドリンクのレシピ（0069 / 0071）。
 *
 * 分量は「名前・数・単位」の3つに分けて持つ。1行の自由文にすると、
 * 「水300」「水 300ml」「お水300cc」が並んで、同じものか見分けが付かない。
 * 単位を選ばせれば、書き方が1つに決まる。
 *
 * 出すときは日本語の言い方に合わせる。小さじと大さじは数より先に来る
 * （「小さじ1」であって「1小さじ」ではない）。適量に数は無い。
 *
 * ここは純関数にしてある。DB も時計も触らないので、テストで確かめられる。
 */

/** 選べる単位。足りなければ増やす。自由に書かせるより、1つに決まるほうがよい */
export const DRINK_UNITS = ['ml', 'L', 'g', '個', '枚', '杯', '小さじ', '大さじ', '適量'] as const

export type DrinkUnit = (typeof DRINK_UNITS)[number]

export const DEFAULT_UNIT: DrinkUnit = 'ml'

/** 数より先に書く単位。日本語では「小さじ1」と言う */
const PREFIX_UNITS: readonly DrinkUnit[] = ['小さじ', '大さじ']

/** 数を持たない単位 */
const NO_AMOUNT_UNITS: readonly DrinkUnit[] = ['適量']

/** 材料の数の上限。これを超えるものは、もうレシピではなく手順書である */
export const MAX_ITEMS = 20

export type DrinkItem = {
  name: string
  /** 適量のように数が無いものは null */
  amount: number | null
  unit: DrinkUnit
}

/** その単位に数が要るか */
export function needsAmount(unit: DrinkUnit): boolean {
  return !NO_AMOUNT_UNITS.includes(unit)
}

/** 空の行を作る。追加したときの初期値 */
export function emptyItem(): DrinkItem {
  return { name: '', amount: null, unit: DEFAULT_UNIT }
}

/**
 * 1つぶんの書き方。
 *
 * 水 300ml / レモン汁 小さじ1 / 氷 適量
 */
export function itemText(item: DrinkItem): string {
  if (!needsAmount(item.unit)) return `${item.name} ${item.unit}`.trim()
  if (item.amount === null) return item.name.trim()
  if (PREFIX_UNITS.includes(item.unit)) return `${item.name} ${item.unit}${item.amount}`.trim()
  return `${item.name} ${item.amount}${item.unit}`.trim()
}

/** 読めない単位は既定に寄せる。DB から来たものをそのまま信じない */
function toUnit(value: unknown): DrinkUnit {
  return DRINK_UNITS.includes(value as DrinkUnit) ? (value as DrinkUnit) : DEFAULT_UNIT
}

/**
 * DB の jsonb を読む。
 *
 * 形が違っていても落とさない。1件のレシピが壊れているだけで、画面全体が
 * 出なくなるほうが困る。
 */
export function toItems(raw: unknown): DrinkItem[] {
  if (!Array.isArray(raw)) return []

  return raw.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const item = row as Record<string, unknown>
    const name = typeof item.name === 'string' ? item.name : ''
    const amount = typeof item.amount === 'number' && Number.isFinite(item.amount) ? item.amount : null
    return [{ name, amount, unit: toUnit(item.unit) }]
  })
}

/** 保存するぶんだけ残す。名前の空いた行は、書きかけのまま閉じたもの */
export function cleanItems(items: DrinkItem[]): DrinkItem[] {
  return items
    .map((item) => ({ ...item, name: item.name.trim() }))
    .filter((item) => item.name)
    .map((item) => (needsAmount(item.unit) ? item : { ...item, amount: null }))
}

/** 入力を確かめる。駄目なら理由を返す */
export function rejectRecipeReason(input: { name: string; items: DrinkItem[] }): string | null {
  if (!input.name.trim()) return '名前を入れてください'

  const items = cleanItems(input.items)
  if (items.length > MAX_ITEMS) return `材料は${MAX_ITEMS}個までにしてください`

  const bad = items.find((item) => needsAmount(item.unit) && (item.amount ?? 0) <= 0)
  if (bad) return `「${bad.name}」の数を入れてください`

  return null
}
