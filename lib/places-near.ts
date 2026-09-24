import type { Place } from '@/types'

/**
 * 現在位置からの距離で絞る。
 *
 * DB も通信もしない純関数にしてある。距離の計算は端末の中だけで済み、
 * Google の API は呼ばない（回数も課金も増えない）。
 *
 * 遠征のときに欲しいのは「いま居るところから行ける店」で、リスト全体では
 * ない。46件が日本じゅうに散っていると、地図は日本全体まで引くしかなく、
 * どれが近いのかが分からない。
 */

export type Point = { lat: number; lng: number }

const EARTH_KM = 6371

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * 2点間の距離（km）。
 *
 * 地球を球として扱う（ヒュベニの式のような扁平率の補正はしない）。
 * 数十kmの範囲で数十mずれる程度で、「3km以内か」を決めるには十分である。
 */
export function distanceKm(a: Point, b: Point): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * 選べる範囲（km）。
 *
 * 歩ける範囲・ひと駅ぶん・遠征先の街ぜんぶ、の3つ。細かく刻んでも
 * 押し分けられない。
 */
export const NEAR_STEPS = [3, 10, 30] as const

export type NearStep = (typeof NEAR_STEPS)[number]

/** 座標を持っている場所だけ、その点からの距離を付けて返す */
function withDistance(places: Place[], here: Point): { place: Place; km: number }[] {
  const rows: { place: Place; km: number }[] = []
  for (const place of places) {
    if (typeof place.lat !== 'number' || typeof place.lng !== 'number') continue
    rows.push({ place, km: distanceKm(here, { lat: place.lat, lng: place.lng }) })
  }
  return rows
}

/**
 * 現在位置から km 以内の場所だけ残す。
 *
 * here が無いとき、または範囲を選んでいないときは全部返す。
 * 座標を引けていない場所は外す。距離が分からないものを「近い」とは言えない。
 */
export function filterByNear(places: Place[], here: Point | null, km: NearStep | null): Place[] {
  if (!here || !km) return places
  return withDistance(places, here)
    .filter((row) => row.km <= km)
    .map((row) => row.place)
}

/** 近い順に並べ替える。座標の無い場所は後ろにまとめる */
export function sortByDistance(places: Place[], here: Point | null): Place[] {
  if (!here) return places

  const located = withDistance(places, here).sort((a, b) => a.km - b.km).map((row) => row.place)
  const rest = places.filter((p) => typeof p.lat !== 'number' || typeof p.lng !== 'number')
  return [...located, ...rest]
}

/**
 * 画面に出す距離。
 *
 * 1km 未満は m にする。「0.4km」より「400m」のほうが、歩くかどうかの
 * 判断に直に効く。
 */
export function distanceText(km: number): string {
  if (km < 1) return `${Math.round(km * 100) * 10}m`
  if (km < 10) return `${km.toFixed(1)}km`
  return `${Math.round(km)}km`
}

/** その場所までの距離。現在位置か座標が無ければ null */
export function distanceOf(place: Place, here: Point | null): number | null {
  if (!here || typeof place.lat !== 'number' || typeof place.lng !== 'number') return null
  return distanceKm(here, { lat: place.lat, lng: place.lng })
}
