/**
 * Google から、建物の名前と徒歩時間をもらう（0075 / 0076）。
 *
 * ふたつ使う。
 *
 * - Places: 名前と住所。OSM の輪郭には名前が無いことが多く、名前が無ければ
 *   調べようがない。
 * - Routes（Compute Route Matrix）: 駅から建物までの徒歩時間。直線距離の
 *   換算だと、川・線路・大通りで回り道になる場所が「徒歩8分」に見える。
 *
 * Places は2通りで聞く。まず種別（住まい）で近い順に聞き、断られたら
 * 「マンション」という言葉で聞き直す。種別の指定は新しいもので、鍵や地域に
 * よっては通らないことがある。そこで止まると、名前が1つも入らない（0076）。
 *
 * どちらも呼んだ回数で課金される。数えて止めるのは呼ぶ側（API ルート）の
 * 仕事にしてある。ここは1回ぶんの呼び出しだけを受け持つ。
 */

import {
  straightWalk,
  type Facility,
  type FacilityKind,
  type FoodPlace,
  type RentBuilding,
  type RentPoint,
  type RentStation,
} from '@/lib/rent'
import { failReason } from '@/lib/rent-osm'

const NEARBY = 'https://places.googleapis.com/v1/places:searchNearby'
const TEXT = 'https://places.googleapis.com/v1/places:searchText'
const MATRIX = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix'

/** 住まいの種別（Places の Table A）。賃貸マンションはここに入る */
export const HOUSING_TYPES = [
  'apartment_building',
  'apartment_complex',
  'condominium_complex',
  'housing_complex',
]

const PLACE_FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.primaryTypeDisplayName',
  'places.types',
].join(',')

/**
 * 飲食店を聞くときの項目（0079）。
 *
 * 評価と件数は、名前や住所より上の課金区分になる。ここでだけ足す。
 */
const FOOD_FIELDS = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.types',
  'places.rating',
  'places.userRatingCount',
].join(',')

/** 飲食店として数えるもの。言葉で聞くので、店でないものが混ざることがある */
const FOOD_TYPES = [
  'restaurant',
  'cafe',
  'bakery',
  'bar',
  'meal_takeaway',
  'meal_delivery',
  'food',
  'coffee_shop',
  'japanese_restaurant',
  'ramen_restaurant',
]

/** 1回で返る上限。Google 側の決まり */
export const NEARBY_MAX = 20

type RawPlace = {
  id?: string
  displayName?: { text?: string }
  formattedAddress?: string
  location?: { latitude?: number; longitude?: number }
  primaryTypeDisplayName?: { text?: string }
  types?: string[]
}

export type HousingResult = {
  items: RentBuilding[]
  /** どう聞いて、どうだったか。画面に出して原因を追えるようにする */
  attempts: string[]
  /**
   * Google に届かなかった、または 4xx で断られた（0098）。
   * 断られた呼び出しは課金されないので、呼ぶ側で予算を戻す
   */
  failed: boolean
}

/** 失敗の中身を短くまとめる。Google は error.message に理由を入れてくる */
/**
 * Google の失敗を1行にする。
 *
 * Places は { error: { message } } で返す。Routes の行列は返事を流すので、
 * 失敗も [ { error: { message } } ] と配列で来る（0096）。配列を読めずに
 * 「HTTP 403」だけになり、API が無効なのか鍵の制限なのかが分からなかった。
 */
async function failText(res: Response): Promise<string> {
  type Fail = { error?: { status?: string; message?: string } }
  const raw = (await res.json().catch(() => null)) as Fail | Fail[] | null
  const body = Array.isArray(raw) ? raw[0] : raw
  const detail = body?.error?.message ?? body?.error?.status ?? ''
  return `HTTP ${res.status}${detail ? ` ${detail.slice(0, 160)}` : ''}`
}

function toBuildings(places: RawPlace[], stations: RentStation[]): RentBuilding[] {
  return places
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
        // Google は建物の諸元を持たない。竣工年は OSM 側にしか入らない
        builtYear: null,
        kind: p.primaryTypeDisplayName?.text ?? 'マンション・アパート',
        walk: straightWalk(point, stations),
      }
    })
    .filter((b): b is RentBuilding => b !== null && Boolean(b.name))
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
): Promise<HousingResult> {
  const attempts: string[] = []
  const circle = {
    center: { latitude: center.lat, longitude: center.lng },
    radius: Math.max(1, Math.min(50_000, radius)),
  }

  // 1. 種別で聞く。これが通れば、住まいだけが近い順に返ってくる
  const near = await fetch(NEARBY, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': PLACE_FIELDS,
    },
    body: JSON.stringify({
      includedTypes: HOUSING_TYPES,
      maxResultCount: NEARBY_MAX,
      rankPreference: 'DISTANCE',
      languageCode: 'ja',
      regionCode: 'JP',
      locationRestriction: { circle },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  }).catch((e: unknown) => {
    attempts.push(`Google 種別: ${failReason(e)}`)
    return null
  })

  if (near?.ok) {
    const body = (await near.json().catch(() => null)) as { places?: RawPlace[] } | null
    const items = toBuildings(body?.places ?? [], stations)
    attempts.push(`Google 種別: ${items.length}件`)
    if (items.length > 0) return { items, attempts, failed: false }
  } else if (near) {
    attempts.push(`Google 種別: ${await failText(near)}`)
  }

  // 2. 言葉で聞き直す。種別が通らない鍵でも、こちらなら返る。
  //    範囲の外に散らばることがあるので、呼ぶ側で円の中だけに絞ること
  const text = await fetch(TEXT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': PLACE_FIELDS,
    },
    body: JSON.stringify({
      textQuery: 'マンション',
      maxResultCount: NEARBY_MAX,
      languageCode: 'ja',
      regionCode: 'JP',
      locationBias: { circle },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  }).catch((e: unknown) => {
    attempts.push(`Google 言葉: ${failReason(e)}`)
    return null
  })

  // 種別の問い合わせが通っていれば、そちらは課金されている。両方とも
  // 断られたときだけ「使っていない」と数える
  const failed = !near?.ok
  if (!text) return { items: [], attempts, failed }
  if (!text.ok) {
    attempts.push(`Google 言葉: ${await failText(text)}`)
    return { items: [], attempts, failed }
  }

  const body = (await text.json().catch(() => null)) as { places?: RawPlace[] } | null
  const items = toBuildings(body?.places ?? [], stations)
  attempts.push(`Google 言葉: ${items.length}件`)
  return { items, attempts, failed: false }
}

/**
 * 円の中の飲食店を、星の数で切って聞く（0079）。
 *
 * Google の検索には最低評価（minRating）を渡せる。こちらで受け取ってから
 * 捨てるのではなく、向こうで切ってもらう。20件しか返らないので、評価の
 * 低い店で埋まると、条件に合う店が入らない。
 */
export async function searchFood(
  key: string,
  center: RentPoint,
  radius: number,
  minRating: number
): Promise<{ items: FoodPlace[]; attempts: string[]; failed: boolean }> {
  const attempts: string[] = []

  const res = await fetch(TEXT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': FOOD_FIELDS,
    },
    body: JSON.stringify({
      textQuery: '飲食店',
      minRating,
      maxResultCount: NEARBY_MAX,
      languageCode: 'ja',
      regionCode: 'JP',
      locationBias: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius: Math.max(1, Math.min(50_000, radius)),
        },
      },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  }).catch((e: unknown) => {
    attempts.push(`飲食店: ${failReason(e)}`)
    return null
  })

  if (!res) return { items: [], attempts, failed: true }
  if (!res.ok) {
    attempts.push(`飲食店: ${await failText(res)}`)
    return { items: [], attempts, failed: true }
  }

  const body = (await res.json().catch(() => null)) as
    | { places?: (RawPlace & { rating?: number })[] }
    | null

  const items = (body?.places ?? [])
    .map((p): FoodPlace | null => {
      const lat = p.location?.latitude
      const lng = p.location?.longitude
      const rating = p.rating
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(rating)) return null
      // 言葉で聞いているので、店でないものが混ざることがある
      if (p.types && p.types.length > 0 && !p.types.some((t) => FOOD_TYPES.includes(t))) return null
      return {
        id: `food-${p.id ?? `${lat},${lng}`}`,
        name: (p.displayName?.text ?? '').trim(),
        rating: rating as number,
        lat: lat as number,
        lng: lng as number,
      }
    })
    .filter((f): f is FoodPlace => f !== null && Boolean(f.name))

  attempts.push(`飲食店: ${items.length}件`)
  return { items, attempts, failed: false }
}

/**
 * まわりの施設を Google に聞く（0083）。
 *
 * ふだんは OSM から取る（1回でまとめて取れて無料）。OSM から取れなかった
 * ときだけここに来る。施設が1つも無いと、一覧が全部「なし」で埋まり、
 * 調べたうえで無いのか、取れていないだけなのかが分からなくなる。
 *
 * 種類は1回の問い合わせにまとめて渡せる。種類ごとに呼ぶと、円の数 × 種類の
 * 回数になって費用が跳ね上がる。
 */
const FACILITY_TYPES = [
  'convenience_store',
  'pharmacy',
  'drugstore',
  'dentist',
  'doctor',
  'hair_care',
  'beauty_salon',
]

/** Google の種類を、こちらの区分に直す。先に見たものが勝つ */
function toFacilityKind(types: string[]): FacilityKind | null {
  if (types.includes('convenience_store')) return 'convenience'
  if (types.includes('pharmacy') || types.includes('drugstore')) return 'pharmacy'
  if (types.includes('dentist')) return 'dentist'
  if (types.includes('doctor')) return 'clinic'
  if (types.includes('hair_care') || types.includes('beauty_salon')) return 'hairdresser'
  return null
}

export async function searchFacilities(
  key: string,
  center: RentPoint,
  radius: number
): Promise<{ items: Facility[]; attempts: string[]; failed: boolean }> {
  const attempts: string[] = []

  const res = await fetch(NEARBY, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.types',
    },
    body: JSON.stringify({
      includedTypes: FACILITY_TYPES,
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
  }).catch((e: unknown) => {
    attempts.push(`Google 施設: ${failReason(e)}`)
    return null
  })

  if (!res) return { items: [], attempts, failed: true }
  if (!res.ok) {
    attempts.push(`Google 施設: ${await failText(res)}`)
    return { items: [], attempts, failed: true }
  }

  const body = (await res.json().catch(() => null)) as { places?: RawPlace[] } | null

  const items = (body?.places ?? [])
    .map((p): Facility | null => {
      const lat = p.location?.latitude
      const lng = p.location?.longitude
      const kind = toFacilityKind(p.types ?? [])
      if (!kind || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
      return {
        id: `gf-${p.id ?? `${lat},${lng}`}`,
        kind,
        name: (p.displayName?.text ?? '').trim(),
        lat: lat as number,
        lng: lng as number,
      }
    })
    .filter((f): f is Facility => f !== null)

  attempts.push(`Google 施設: ${items.length}件`)
  return { items, attempts, failed: false }
}

/**
 * 駅の場所を名前で引く（0093）。
 *
 * lookupPlaces と同じ Text Search だが、駄目だったときに理由を持ち帰る。
 * 「引けませんでした」だけでは、鍵なのか、Google の断りなのか、こちらの
 * 聞き方なのかが分からない。
 */
export async function findStation(
  key: string,
  name: string,
  bias?: RentPoint & { radius: number }
): Promise<{ hit: RentPoint | null; reason: string }> {
  const res = await fetch(TEXT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.location,places.types',
    },
    body: JSON.stringify({
      textQuery: name,
      languageCode: 'ja',
      regionCode: 'JP',
      maxResultCount: 5,
      ...(bias
        ? {
            locationBias: {
              circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: bias.radius },
            },
          }
        : {}),
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  }).catch((e: unknown) => {
    return { failed: failReason(e) } as const
  })

  if ('failed' in res) return { hit: null, reason: `Google: ${res.failed}` }
  if (!res.ok) return { hit: null, reason: `Google: ${await failText(res)}` }

  const body = (await res.json().catch(() => null)) as { places?: RawPlace[] } | null
  const places = (body?.places ?? []).filter(
    (p) => Number.isFinite(p.location?.latitude) && Number.isFinite(p.location?.longitude)
  )
  if (places.length === 0) return { hit: null, reason: 'Google: 該当なし' }

  const stationTypes = ['train_station', 'subway_station', 'light_rail_station', 'transit_station']
  const stations = places.filter((p) => (p.types ?? []).some((t) => stationTypes.includes(t)))
  // 名前がぴったり合うものを先に。「御徒町駅」で「上野御徒町駅」を採らない。
  // 駅の種類が付いていなくても、名前が合えば採る（Google の種類は揺れる）
  const pick =
    stations.find((p) => p.displayName?.text === name) ??
    places.find((p) => p.displayName?.text === name) ??
    stations[0] ??
    places[0]

  return {
    hit: { lat: pick.location!.latitude as number, lng: pick.location!.longitude as number },
    reason: `Google: ${places.length}件 → ${pick.displayName?.text ?? ''}`,
  }
}

/**
 * 駅の場所を Geocoding で引く（0094）。
 *
 * Places の Text Search は Google Cloud 側の1日の割り当てに当たりやすく、
 * 当たると駅が1つも足せなくなった。Geocoding は別の割り当てで、単価も
 * 1/6 ほど。「駅名 → 座標」ならこちらで足りるので、先にこちらを使う。
 *
 * 都内の枠（bounds）を添えて、同じ名前の別の町の駅を避ける。
 */
const TOKYO_BOUNDS = '35.50,139.50|35.90,139.95'

export async function geocodeStation(
  key: string,
  name: string
): Promise<{ hit: RentPoint | null; reason: string }> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('address', name)
  url.searchParams.set('language', 'ja')
  url.searchParams.set('region', 'jp')
  url.searchParams.set('components', 'country:JP')
  url.searchParams.set('bounds', TOKYO_BOUNDS)
  url.searchParams.set('key', key)

  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) }).catch(
    (e: unknown) => ({ failed: failReason(e) }) as const
  )
  if ('failed' in res) return { hit: null, reason: `Geocoding: ${res.failed}` }
  if (!res.ok) return { hit: null, reason: `Geocoding: HTTP ${res.status}` }

  const body = (await res.json().catch(() => null)) as {
    status?: string
    error_message?: string
    results?: {
      types?: string[]
      formatted_address?: string
      geometry?: { location?: { lat?: number; lng?: number } }
    }[]
  } | null
  if (!body) return { hit: null, reason: 'Geocoding: 返事を読めず' }
  if (body.status !== 'OK') {
    return {
      hit: null,
      reason: `Geocoding: ${body.status ?? '?'}${body.error_message ? ` ${body.error_message.slice(0, 80)}` : ''}`,
    }
  }

  const stationTypes = ['train_station', 'subway_station', 'light_rail_station', 'transit_station']
  const results = body.results ?? []
  // 駅として返ったものを採る。住所や町名に丸められた結果は使わない
  const pick =
    results.find((r) => (r.types ?? []).some((t) => stationTypes.includes(t))) ?? null
  const point = pick?.geometry?.location
  if (!pick || typeof point?.lat !== 'number' || typeof point?.lng !== 'number') {
    return { hit: null, reason: `Geocoding: 駅として返らず（${results.length}件）` }
  }
  return {
    hit: { lat: point.lat, lng: point.lng },
    reason: `Geocoding: ${pick.formatted_address ?? ''}`.slice(0, 80),
  }
}

export type MatrixCell = { originIndex: number; destinationIndex: number; minutes: number }

export type MatrixResult = { cells: MatrixCell[] | null; attempt: string }

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
): Promise<MatrixResult> {
  if (origins.length === 0 || destinations.length === 0) {
    return { cells: [], attempt: '徒歩ルート: 測るものなし' }
  }

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

  if (!res) return { cells: null, attempt: '徒歩ルート: 接続できず' }
  if (!res.ok) return { cells: null, attempt: `徒歩ルート: ${await failText(res)}` }

  const body = (await res.json().catch(() => null)) as
    | { originIndex?: number; destinationIndex?: number; duration?: string; condition?: string }[]
    | null
  if (!Array.isArray(body)) return { cells: null, attempt: '徒歩ルート: 返事を読めず' }

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
  return { cells, attempt: `徒歩ルート: ${cells.length}組` }
}
