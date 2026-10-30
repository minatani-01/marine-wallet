/**
 * 建物の輪郭を OpenStreetMap から取る（0075）。
 *
 * 範囲の中に建っているものを「まとめて」ほしいので、1回の問い合わせで
 * 全部返ってくるここを土台にする。鍵も費用も要らない。
 *
 * 代わりに名前は欠けることが多い。名前の無い建物は Google 側で補う
 * （lib/rent.ts の mergeBuildings）。それでも分からないものは「名前の無い
 * 建物」として地図にだけ出す。現地で見れば分かることがある。
 *
 * 公開サーバーなので、節度を持って使う。範囲を四角で切って1回だけ、
 * 件数の上限も付けて呼ぶ。
 */

import { straightWalk, type Bounds, type RentBuilding, type RentStation } from '@/lib/rent'

/** 本家とミラー。片方が重いことがあるので、落ちたらもう片方を試す */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

/** 1回で受け取る建物の数。多すぎると地図も一覧も読めない */
const MAX_ELEMENTS = 1200

/** 住まいとして使われている建物だけ拾う。店舗や倉庫まで出すと読めない */
const BUILDING_VALUES = '^(apartments|residential|dormitory)$'

const KIND_LABELS: Record<string, string> = {
  apartments: 'マンション・アパート',
  residential: '住宅',
  dormitory: '寮・社宅',
}

type OverpassElement = {
  type?: string
  id?: number
  center?: { lat?: number; lon?: number }
  lat?: number
  lon?: number
  tags?: Record<string, string>
}

/** 階数は「3」「3;4」「地上5」など揺れるので、数字として読めるときだけ使う */
function toLevels(value: string | undefined): number | null {
  if (!value) return null
  const n = Number(String(value).match(/\d+/)?.[0])
  return Number.isInteger(n) && n > 0 && n < 200 ? n : null
}

function buildQuery(bounds: Bounds): string {
  const box = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`
  return [
    '[out:json][timeout:18];',
    '(',
    `  way["building"~"${BUILDING_VALUES}"](${box});`,
    `  relation["building"~"${BUILDING_VALUES}"](${box});`,
    ');',
    `out tags center ${MAX_ELEMENTS};`,
  ].join('\n')
}

/**
 * 範囲の中の建物を取る。
 *
 * 取れなければ null を返す。例外にはしない。Google 側だけでも一覧は出せる
 * ので、ここで画面を止める必要は無い。
 */
export async function fetchOsmBuildings(
  bounds: Bounds,
  stations: RentStation[]
): Promise<RentBuilding[] | null> {
  const query = buildQuery(bounds)

  // 1回の検索ぜんぶで60秒までなので、待つ時間を先に割り振っておく。
  // 本家で粘りすぎると、名前も徒歩時間も取りに行けないまま時間切れになる
  const budgets = [15_000, 10_000]

  for (const [index, endpoint] of ENDPOINTS.entries()) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }).toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(budgets[index] ?? 10_000),
    }).catch(() => null)

    if (!res || !res.ok) continue

    const body = (await res.json().catch(() => null)) as { elements?: OverpassElement[] } | null
    if (!body) continue

    return (body.elements ?? [])
      .map((e) => toBuilding(e, stations))
      .filter((b): b is RentBuilding => b !== null)
  }

  return null
}

function toBuilding(e: OverpassElement, stations: RentStation[]): RentBuilding | null {
  const lat = e.center?.lat ?? e.lat
  const lng = e.center?.lon ?? e.lon
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const tags = e.tags ?? {}
  const point = { lat: lat as number, lng: lng as number }
  // 日本語名があればそちらを採る。name が英字表記のことがある
  const name = (tags['name:ja'] || tags.name || '').trim()

  return {
    id: `osm-${e.type ?? 'way'}-${e.id ?? 0}`,
    source: 'osm',
    name,
    address: addressOf(tags),
    ...point,
    levels: toLevels(tags['building:levels']),
    kind: KIND_LABELS[tags.building ?? ''] ?? '住まい',
    walk: straightWalk(point, stations),
  }
}

/**
 * 住所。
 *
 * 日本の OSM は番地まで入っていることが少ないので、入っているぶんだけ
 * つなぐ。何も無ければ空文字にして、画面では出さない。
 */
function addressOf(tags: Record<string, string>): string {
  const parts = [
    tags['addr:province'] ?? tags['addr:state'],
    tags['addr:city'],
    tags['addr:suburb'],
    tags['addr:quarter'],
    tags['addr:neighbourhood'],
    tags['addr:block_number'],
    tags['addr:housenumber'],
  ].filter(Boolean)
  return parts.join('')
}
