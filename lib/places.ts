import type { Place, PlaceKind, Revisit } from '@/types'

/**
 * 行きたい場所・行った場所の整理。
 *
 * DB も時計も触らない純関数にしてある。表は1つで、行った日が入っているか
 * どうかで「行きたい」と「行った」を分ける。行くたびに書き写す作りにすると、
 * 行きたい側で書いたメモが失われる。
 */

export const PLACE_KIND_LABEL: Record<PlaceKind, string> = {
  sight: '観光地',
  food: '飲食',
}

export const PLACE_KINDS: PlaceKind[] = ['sight', 'food']

export function placeKindLabel(kind: PlaceKind): string {
  return PLACE_KIND_LABEL[kind] ?? kind
}

/**
 * ジャンルを持つ種別かどうか。
 *
 * 観光地には付けない。「名所」「公園」と分けても、行きたい場所が20件も
 * 並ぶことがなく、分ける意味が薄い。ジャンルは飲食だけのものとする。
 */
export function hasGenre(kind: PlaceKind): boolean {
  return kind === 'food'
}

/**
 * Google マップで開くリンク。
 *
 * 公式の URL の形（api=1）を使う。鍵も課金も要らず、スマートフォンでは
 * アプリが開く。座標は持たないので、名前と場所の手がかりで検索させる。
 * 店名だけだと同名の別店舗に飛ぶことがあるため、area も混ぜる。
 */
export function mapsUrl(place: Pick<Place, 'name' | 'area'>): string {
  const query = [place.area, place.name].filter(Boolean).join(' ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

/**
 * 住所を、場所の手がかりとして短くする。
 *
 * Google が返すのは「東京都中央区銀座５丁目１４−１７ USB1階」のような
 * 完全な住所で、これをそのまま持つと一覧が住所で埋まる。46件すべてが
 * 別々の住所になるので、見比べる手がかりにもならない。
 *
 * 市区町村と町名だけ残す。「中央区銀座」まであれば、どのあたりの店かが
 * 分かり、地図で開くときの手がかりとしても十分に効く。都道府県は落とす。
 * 同じ県内の店ばかり並ぶので、付いていても見分けがつかない。
 *
 * 丁目より先は数字から始まるので、そこで切る。「二番町」のような漢数字は
 * 町名の一部なので切らない。
 */
export function shortArea(address: string): string {
  const withoutPrefecture = address.replace(/^.{2,3}[都道府県]/, '')
  const cut = withoutPrefecture.split(/[0-9０-９]/)[0].trim()
  return cut || address.trim()
}

/**
 * また行きたいかの札（0046）。
 *
 * 行ったかどうかだけでは、次にどこへ行くかを決められない。行った店が
 * 増えるほど「どれがまた行きたい店だったか」を思い出せなくなる。
 */
export const REVISIT_LABEL: Record<Exclude<Revisit, ''>, string> = {
  yes: 'リピあり',
  no: 'リピなし',
}

export const REVISIT_CHOICES: Exclude<Revisit, ''>[] = ['yes', 'no']

/**
 * 札を押したときの書き込み内容。
 *
 * 押してある札をもう一度押すと、行きたい側へ戻す（間違えて押したときに
 * 戻せないと直せない）。まだ行っていない場所に押したときは、その日を
 * 行った日として入れる。すでに行った場所なら日付はそのまま。
 */
export function revisitPatch(
  place: Pick<Place, 'visited_on' | 'revisit'>,
  choice: Exclude<Revisit, ''>,
  today: string
): { visited_on: string | null; revisit: Revisit } {
  if (place.revisit === choice) return { visited_on: null, revisit: '' }
  return { visited_on: place.visited_on ?? today, revisit: choice }
}

/** 行った場所かどうか */
export function isVisited(place: Pick<Place, 'visited_on'>): boolean {
  return Boolean(place.visited_on)
}

export type PlaceLists = {
  /** まだ行っていない場所。古く入れたものから */
  wish: Place[]
  /** 行った場所。新しく行ったものから */
  visited: Place[]
}

export function splitPlaces(places: Place[]): PlaceLists {
  return {
    wish: places.filter((p) => !isVisited(p)),
    visited: places
      .filter(isVisited)
      .sort((a, b) => (b.visited_on ?? '').localeCompare(a.visited_on ?? '')),
  }
}

/** 種別で絞る。kind が null なら全部 */
export function filterByKind(places: Place[], kind: PlaceKind | null): Place[] {
  if (!kind) return places
  return places.filter((p) => p.kind === kind)
}

/**
 * 押した言葉を入れる・外す。同じ言葉は二度入れない。
 *
 * 絞り込みの札も、登録画面の札も同じ動きにする。押したら付き、
 * もう一度押したら外れる。
 */
export function toggleTag<T extends string>(list: T[], name: T): T[] {
  return list.includes(name) ? list.filter((item) => item !== name) : [...list, name]
}

/** 選んだもののどれかに当たれば残す。何も選んでいなければ全部 */
function matchAny(values: readonly string[], picked: readonly string[]): boolean {
  if (picked.length === 0) return true
  return picked.some((name) => values.includes(name))
}

/**
 * ジャンルで絞る。選んでいなければ全部。
 *
 * 1つの店が焼肉と居酒屋を兼ねることはある（0049）。どちらで絞っても
 * 出るようにしたいので、持っている言葉のどれかに当たれば残す。
 * 複数選んだときも「どれか」で扱う。「焼肉と寿司の両方をやる店」を
 * 探したいことは、まず無い。
 */
export function filterByGenres(places: Place[], picked: string[]): Place[] {
  return places.filter((p) => matchAny(p.genres, picked))
}

/** 食材で絞る。ジャンルとは別の軸で、掛け合わせて効く（0049） */
export function filterByIngredients(places: Place[], picked: string[]): Place[] {
  return places.filter((p) => matchAny(p.ingredients, picked))
}

/**
 * いま出ている場所に実際に入っているジャンル。
 *
 * 候補の一覧ではなく、入っている言葉から作る。登録していないジャンルの
 * ボタンを押しても0件になるだけで、押す意味が無い。
 *
 * 並びは設定画面で決めた順（order）に合わせる。よく使うものを上に置いた
 * のに、ここだけ五十音で並ぶと置いた意味が無い。候補に無い言葉（登録画面で
 * 直接入れたもの）は後ろにまとめ、そのなかでは五十音で並べる。
 */
export function genresOf(places: Place[], order: string[] = []): string[] {
  const seen = new Set<string>()
  for (const place of places) {
    // 観光地に付いたままの言葉は出さない。種別を変えても消さずに残すため
    if (!hasGenre(place.kind)) continue
    for (const genre of place.genres) if (genre) seen.add(genre)
  }

  const rank = new Map(order.map((name, index) => [name, index]))
  return [...seen].sort((a, b) => {
    const ra = rank.get(a) ?? Number.MAX_SAFE_INTEGER
    const rb = rank.get(b) ?? Number.MAX_SAFE_INTEGER
    return ra === rb ? a.localeCompare(b, 'ja') : ra - rb
  })
}

/**
 * いま出ている場所に実際に入っている食材。ジャンルと同じ考え方で作る。
 */
export function ingredientsOf(places: Place[], order: string[] = []): string[] {
  const seen = new Set<string>()
  for (const place of places) {
    // 観光地に付いたままの言葉は出さない。種別を変えても消さずに残すため
    if (!hasGenre(place.kind)) continue
    for (const item of place.ingredients) if (item) seen.add(item)
  }

  const rank = new Map(order.map((name, index) => [name, index]))
  return [...seen].sort((a, b) => {
    const ra = rank.get(a) ?? Number.MAX_SAFE_INTEGER
    const rb = rank.get(b) ?? Number.MAX_SAFE_INTEGER
    return ra === rb ? a.localeCompare(b, 'ja') : ra - rb
  })
}

/**
 * 言葉で探す。名前・場所・ジャンル・食材・メモのどれかに含まれていれば残す。
 *
 * 大文字小文字は区別しない。空白で区切った語は「すべて含む」で扱う。
 * 「幕張 焼肉」で、幕張にある焼肉だけを出せるようにするため。
 */
export function searchPlaces(places: Place[], text: string): Place[] {
  const words = text.trim().toLowerCase().split(/[\s　]+/).filter(Boolean)
  if (words.length === 0) return places

  return places.filter((place) => {
    const haystack = [place.name, place.area, ...place.genres, ...place.ingredients, place.note]
      .join(' ')
      .toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}
