import type { PlaceKind } from '@/types'

/**
 * Google の場所の種類（types / primaryType）を、こちらの言葉に読み替える。
 *
 * DB も通信もしない純関数にしてある。
 *
 * 種別（飲食か、それ以外か）とジャンル（寿司・ラーメンなど）は、登録する人が
 * 決めることではない。Google がすでに持っているものを写せばよい。
 * 取り込みで「全部まとめて飲食」と入れたぶんも、これで直せる。
 *
 * 受け取る値の例:
 *   primaryType 'sushi_restaurant'
 *   types       ['sushi_restaurant', 'restaurant', 'food', 'point_of_interest']
 */

/**
 * 飲食を表す種類のうち、末尾が _restaurant でないもの。
 *
 * _shop で終わるものをまとめて飲食にはできない。bicycle_shop や
 * pet_store まで飲食になってしまう。飲食のものだけを並べる。
 */
const FOOD_TYPES = new Set([
  'restaurant',
  'food',
  'cafe',
  'cafeteria',
  'coffee_shop',
  'tea_house',
  'bar',
  'bar_and_grill',
  'wine_bar',
  'pub',
  'bakery',
  'deli',
  'diner',
  'food_court',
  'meal_delivery',
  'meal_takeaway',
  'steak_house',
  'sandwich_shop',
  'bagel_shop',
  'donut_shop',
  'ice_cream_shop',
  'dessert_shop',
  'juice_shop',
  'chocolate_shop',
  'candy_store',
  'confectionery',
  'acai_shop',
])

/** 飲食を表す種類かどうか */
export function isFoodType(type: string): boolean {
  return type.endsWith('_restaurant') || FOOD_TYPES.has(type)
}

/**
 * 種別を決める。
 *
 * 飲食を表す種類がひとつでもあれば飲食、無ければ観光地。こちらの種別は
 * 2つしか無いので、飲食でないものはすべて観光地として扱う。
 * 何も分からないときは null を返し、いま入っている種別に触らない。
 */
export function kindFromTypes(types: string[]): PlaceKind | null {
  if (types.length === 0) return null
  return types.some(isFoodType) ? 'food' : 'sight'
}

/**
 * 料理の種類を表す Google の言葉と、こちらのジャンル。
 *
 * 言い切れるものだけを書く。korean_restaurant を焼肉にするような読み替えは
 * しない。焼肉ではない韓国料理店に焼肉と付けてしまう。
 */
const GENRE_BY_TYPE: Record<string, string> = {
  sushi_restaurant: '寿司',
  ramen_restaurant: 'ラーメン',
  barbecue_restaurant: '焼肉',
  steak_house: 'ステーキ',
  seafood_restaurant: '海鮮',
  pizza_restaurant: 'ピザ',
  hamburger_restaurant: 'ハンバーガー',
  fast_food_restaurant: 'ファストフード',
  buffet_restaurant: 'ビュッフェ',
  japanese_restaurant: '和食',
  chinese_restaurant: '中華',
  italian_restaurant: 'イタリアン',
  french_restaurant: 'フレンチ',
  korean_restaurant: '韓国料理',
  thai_restaurant: 'タイ料理',
  indian_restaurant: 'インド料理',
  vietnamese_restaurant: 'ベトナム料理',
  mexican_restaurant: 'メキシコ料理',
  spanish_restaurant: 'スペイン料理',
  asian_restaurant: 'アジア料理',
  cafe: 'カフェ',
  coffee_shop: 'カフェ',
  cat_cafe: 'カフェ',
  dog_cafe: 'カフェ',
  tea_house: 'カフェ',
  bakery: 'パン',
  bar: 'バー',
  wine_bar: 'バー',
  pub: 'バー',
  ice_cream_shop: 'スイーツ',
  dessert_shop: 'スイーツ',
  dessert_restaurant: 'スイーツ',
  donut_shop: 'スイーツ',
  confectionery: 'スイーツ',
}

/**
 * 料理の中身を表さない言葉。
 *
 * これらが主な種類のときは、Google の表示名（「レストラン」など）を
 * ジャンルとして入れない。入れても何の店か分からず、札が増えるだけになる。
 */
const VAGUE_TYPES = new Set([
  'restaurant',
  'food',
  'store',
  'establishment',
  'point_of_interest',
  'meal_delivery',
  'meal_takeaway',
  'food_court',
])

/** 1つの場所に付けるジャンルの上限。並べすぎると一覧が読めなくなる */
const MAX_GENRES = 2

/**
 * ジャンルを決める。飲食でないものには付けない（0044）。
 *
 * まず主な種類、次にそのほかの種類の順に見る。どれも読み替えられず、
 * 主な種類が中身を表しているときだけ、Google の日本語の表示名をそのまま使う。
 * 表にない料理（「ジンギスカン店」など）を取りこぼさないため。
 *
 * @param primaryType Google の primaryType
 * @param types Google の types
 * @param displayName primaryTypeDisplayName の文字列（日本語で取る）
 */
export function genresFromTypes(
  primaryType: string,
  types: string[],
  displayName = ''
): string[] {
  const found: string[] = []
  for (const type of [primaryType, ...types]) {
    const genre = GENRE_BY_TYPE[type]
    if (genre && !found.includes(genre)) found.push(genre)
    if (found.length >= MAX_GENRES) return found
  }

  if (found.length === 0 && displayName && primaryType && !VAGUE_TYPES.has(primaryType)) {
    return [displayName]
  }
  return found
}

export type Classified = {
  kind: PlaceKind | null
  genres: string[]
}

/**
 * いま入っているものに、Google から分かったぶんを足す。
 *
 * ジャンルは足すだけで、消さない。手で入れたものを黙って消すと、
 * 直したことが無かったことになる。種別が観光地に変わってもそのまま残す。
 * 観光地のジャンルは画面に出ないので（0044）、残っていても邪魔にならず、
 * 種別を戻したときに書き直さずに済む。
 */
export function mergeGenres(current: string[], found: string[]): string[] {
  const merged = [...current]
  for (const genre of found) if (!merged.includes(genre)) merged.push(genre)
  return merged
}

/**
 * Google の答えから、書き込む内容を作る。
 *
 * 検索の画面から足すときも、毎朝の閉店チェックに相乗りするときも、
 * 同じ規則で書きたいのでここにまとめる。
 *
 * 種別は分かったときだけ入れ替える。分からないものを「観光地」に
 * 寄せてしまうと、閉店の確認から外れる。
 */
export function classificationPatch(
  current: { kind: string; genres: string[] },
  primaryType: string,
  types: string[],
  displayName = ''
): { kind?: PlaceKind; genres: string[] } {
  const found = classifyPlace(primaryType, types, displayName)
  return {
    ...(found.kind ? { kind: found.kind } : {}),
    genres: mergeGenres(current.genres, found.genres),
  }
}

/**
 * Google の答えから、種別とジャンルをまとめて出す。
 *
 * 観光地にジャンルは付けない。公園や城を「名所」「公園」と分けても、
 * 行きたい場所が20件も並ぶことがなく、分ける意味が薄い（0044）。
 */
export function classifyPlace(
  primaryType: string,
  types: string[],
  displayName = ''
): Classified {
  const kind = kindFromTypes(types.length > 0 ? types : primaryType ? [primaryType] : [])
  return {
    kind,
    genres: kind === 'food' ? genresFromTypes(primaryType, types, displayName) : [],
  }
}
