/**
 * Google から、建物の名前と徒歩時間をもらう（0075）。
 *
 * ふたつ使う。
 *
 * - Places（Nearby Search）: 名前と住所。OSM の輪郭には名前が無いことが
 *   多く、名前が無ければ調べようがない。
 * - Routes（Compute Route Matrix）: 駅から建物までの徒歩時間。直線距離の
 *   換算だと、川・線路・大通りで回り道になる場所が「徒歩8分」に見える。
 *
 * どちらも呼んだ回数で課金される。数えて止めるのは呼ぶ側（API ルート）の
 * 仕事にしてある。ここは1回ぶんの呼び出しだけを受け持つ。
 */

import { straightWalk, type RentBuilding, type RentPoint, type RentStation } from '@/lib/rent'

const NEARBY = 'https://places.googleapis.com/v1/places:searchNearby'
const MATRIX = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix'

/** 住まいの種別（Places の Table A）。賃貸マンションはここに入る */
export const HOUSING_TYPES = [
  'apartment_building',
  'apartment_complex',
  'condominium_complex',
  'housing_complex',
]

const NEARBY_FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.primaryTypeDisplayName',
].join(',')

/** 1回の Nearby Search で返る上限。Google 側の決まり */
export const NEARBY_MAX = 20

type RawPlace = {
  id?: string
  displayName?: { text?: string }
  formattedAddress?: string
  location?: { latitude?: number; longitude?: number }
  primaryTypeDisplayName?: { text?: string }
}

/**
 * 円の中の集合住宅を聞く。1回ぶん。
 *
 * 近い順に並べてもらう。人気順だと、円の端にある有名な建物が先に来て、
 * 真ん中のありふれたマンションが20件からあふれる。
 */
export async function searchHousing(
  key: string,
  center: RentPoint,
  radius: number,
  stations: RentStation[]
): Promise<RentBuilding[] | null> {
  const res = await fetch(NEARBY, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': NEARBY_FIELDS,
    },
    body: JSON.stringify({
      includedTypes: HOUSING_TYPES,
      maxResultCount: NEARBY_MAX,
      rankPreference: 'DISTANCE',
      languageCode: 'ja',
      regionCode: 'JP',
      locationRestriction: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius: Math.max(1, Math.min(50_000, radius)),
        },
      },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null)

  if (!res || !res.ok) return null

  const body = (await res.json().catch(() => null)) as { places?: RawPlace[] } | null
  if (!body) return null

  return (body.places ?? [])
    .map((p): RentBuilding | null => {
      const lat = p.location?.latitude
      const lng = p.location?.longitude
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
      const point = { lat: lat as number, lng: lng as number }
      return {
        id: `g-${p.id ?? `${lat},${lng}`}`,
        source: 'google' as const,
        name: (p.displayName?.text ?? '').trim(),
        // 郵便番号は場所の手がかりにならないので落とす（places と同じ扱い）
        address: (p.formattedAddress ?? '').replace(/^〒\d{3}-?\d{4}\s*/, ''),
        ...point,
        levels: null,
        kind: p.primaryTypeDisplayName?.text ?? 'マンション・アパート',
        walk: straightWalk(point, stations),
      }
    })
    .filter((b): b is RentBuilding => b !== null && Boolean(b.name))
}

export type MatrixCell = { originIndex: number; destinationIndex: number; minutes: number }

/**
 * 駅 × 建物の徒歩時間を測る。
 *
 * 1回のリクエストで「駅数 × 建物数」ぶんの課金単位（element）を使う。
 * Google 側の上限は625なので、呼ぶ側でそれより十分少なく切っておくこと。
 *
 * 返りは element ごとの配列で、順番は保証されない。originIndex と
 * destinationIndex で元の並びに戻す。
 */
export async function walkMatrix(
  key: string,
  origins: RentPoint[],
  destinations: RentPoint[]
): Promise<MatrixCell[] | null> {
  if (origins.length === 0 || destinations.length === 0) return []

  const waypoint = (p: RentPoint) => ({
    waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } },
  })

  const res = await fetch(MATRIX, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition',
    },
    body: JSON.stringify({
      origins: origins.map(waypoint),
      destinations: destinations.map(waypoint),
      travelMode: 'WALK',
      units: 'METRIC',
      languageCode: 'ja',
      regionCode: 'JP',
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null)

  if (!res || !res.ok) return null

  const body = (await res.json().catch(() => null)) as
    | { originIndex?: number; destinationIndex?: number; duration?: string; condition?: string }[]
    | null
  if (!Array.isArray(body)) return null

  const cells: MatrixCell[] = []
  for (const row of body) {
    // 道が見つからなかった組み合わせは、その組だけ落ちてくる
    if (row.condition && row.condition !== 'ROUTE_EXISTS') continue
    const seconds = Number(String(row.duration ?? '').replace('s', ''))
    if (!Number.isFinite(seconds)) continue
    cells.push({
      originIndex: row.originIndex ?? 0,
      destinationIndex: row.destinationIndex ?? 0,
      minutes: Math.max(1, Math.ceil(seconds / 60)),
    })
  }
  return cells
}
