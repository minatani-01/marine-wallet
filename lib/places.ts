import type { Place, PlaceKind } from '@/types'

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
 * 登録するときに出すジャンルの候補。
 *
 * ここに無い言葉も入れられる（「立ち食いそば」など）。候補は入力を早くする
 * ためのもので、決まった一覧ではない。絞り込みは実際に入っている言葉から
 * 作るので、候補を増やしても画面が散らからない。
 */
export const GENRE_SUGGESTIONS: Record<PlaceKind, string[]> = {
  food: ['焼肉', '寿司', 'ラーメン', '居酒屋', '海鮮', '定食', 'カフェ', 'スイーツ', 'B級グルメ'],
  sight: ['名所', '温泉・銭湯', '公園', '博物館・美術館', '展望', '買い物', 'イベント'],
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

/** ジャンルで絞る。genre が null なら全部 */
export function filterByGenre(places: Place[], genre: string | null): Place[] {
  if (!genre) return places
  return places.filter((p) => p.genre === genre)
}

/**
 * いま出ている場所に実際に入っているジャンル。
 *
 * 候補の一覧ではなく、入っている言葉から作る。登録していないジャンルの
 * ボタンを押しても0件になるだけで、押す意味が無い。
 */
export function genresOf(places: Place[]): string[] {
  const seen = new Set<string>()
  for (const place of places) {
    if (place.genre) seen.add(place.genre)
  }
  return [...seen].sort((a, b) => a.localeCompare(b, 'ja'))
}

/**
 * 言葉で探す。名前・場所・ジャンル・メモのどれかに含まれていれば残す。
 *
 * 大文字小文字は区別しない。空白で区切った語は「すべて含む」で扱う。
 * 「幕張 焼肉」で、幕張にある焼肉だけを出せるようにするため。
 */
export function searchPlaces(places: Place[], text: string): Place[] {
  const words = text.trim().toLowerCase().split(/[\s　]+/).filter(Boolean)
  if (words.length === 0) return places

  return places.filter((place) => {
    const haystack = [place.name, place.area, place.genre, place.note]
      .join(' ')
      .toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}
