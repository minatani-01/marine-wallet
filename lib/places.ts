import { stadiumById } from '@/lib/stadiums'
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

/** 近くの球場の短い名前。結び付けていなければ null */
export function placeStadiumLabel(place: Pick<Place, 'stadium_id'>): string | null {
  if (!place.stadium_id) return null
  return stadiumById(place.stadium_id)?.short ?? null
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
 * 球場ごとにまとめる。遠征の計画に使う。
 * 球場を結び付けていない場所は最後に「その他」としてまとめる。
 */
export function groupByStadium(places: Place[]): { label: string; places: Place[] }[] {
  const groups = new Map<string, Place[]>()

  for (const place of places) {
    const label = placeStadiumLabel(place) ?? 'その他'
    groups.set(label, [...(groups.get(label) ?? []), place])
  }

  return [...groups.entries()]
    .map(([label, list]) => ({ label, places: list }))
    .sort((a, b) => {
      if (a.label === 'その他') return 1
      if (b.label === 'その他') return -1
      return a.label.localeCompare(b.label, 'ja')
    })
}
