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
 * 件数の上限も付けて呼ぶ。サーバーは寄付で動いていて、混んでいると 429 や
 * 504 を返す。クラウドからの呼び出しは断られることもあるので、何か所か
 * 用意して、駄目だった理由をそのまま持ち帰る（0076）。
 */

import {
  expandBounds,
  straightWalk,
  type Bounds,
  type Facility,
  type FacilityKind,
  type RentBuilding,
  type RentStation,
} from '@/lib/rent'

/**
 * 問い合わせ先。上から順に試す。
 *
 * 日本のミラー（osm.jp）を先に置く。日本の範囲しか聞かないうえ、本家より
 * 空いていることが多い。待つ時間も先に割り振っておく。1回の検索ぜんぶで
 * 60秒までなので、1か所で粘ると名前も徒歩時間も取りに行けなくなる。
 */
const ENDPOINTS = [
  { host: 'overpass.osm.jp', url: 'https://overpass.osm.jp/api/interpreter', ms: 14_000 },
  { host: 'overpass-api.de', url: 'https://overpass-api.de/api/interpreter', ms: 12_000 },
  { host: 'kumi.systems', url: 'https://overpass.kumi.systems/api/interpreter', ms: 10_000 },
  { host: 'private.coffee', url: 'https://overpass.private.coffee/api/interpreter', ms: 8_000 },
]

/** 1回で受け取る建物の数。多すぎると地図も一覧も読めない */
const MAX_ELEMENTS = 1500

/** まわりの施設の数。コンビニは密なので、建物ほどは要らないが少なすぎても困る */
const MAX_FACILITIES = 600

/**
 * 施設を探す範囲の広げ幅（m）。
 *
 * 範囲のふちに建つ建物にとっては、外にある店がいちばん近いことがある。
 * 徒歩10分（800m）まで選べるので、そのぶんを見込む
 */
const FACILITY_MARGIN = 900

/** 住まいとして使われている建物。building の値で見分ける */
const KIND_LABELS: Record<string, string> = {
  apartments: 'マンション・アパート',
  residential: '住宅',
  dormitory: '寮・社宅',
  house: '戸建て',
  detached: '戸建て',
  semidetached_house: '戸建て',
  terrace: '長屋',
}

/**
 * 住まいではないもの。
 *
 * 名前の付いた建物も拾うので（マンションが building=yes で入っていることが
 * あるため）、店や事務所が混ざる。そこはタグで落とす。
 */
const NOT_HOMES = ['shop', 'amenity', 'office', 'tourism', 'leisure', 'healthcare', 'craft']

type OverpassElement = {
  type?: string
  id?: number
  center?: { lat?: number; lon?: number }
  lat?: number
  lon?: number
  tags?: Record<string, string>
}

/**
 * 失敗の理由を短い言葉にする。
 *
 * fetch の失敗は名前が TypeError になるだけで中身が分からない。本当の理由は
 * cause に入っているので、そちらを出す。
 */
export function failReason(e: unknown): string {
  if (!(e instanceof Error)) return '接続できず'
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return '時間切れ'
  const cause = (e as { cause?: unknown }).cause
  const message = cause instanceof Error ? cause.message : e.message
  return message.slice(0, 60) || e.name
}

export type OsmResult = {
  /** 取れた建物。1か所も答えなければ null */
  buildings: RentBuilding[] | null
  /** まわりの施設（0077）。建物と同じ1回の問い合わせで取る */
  facilities: Facility[]
  /** どこに聞いて、どうだったか。画面に出して原因を追えるようにする */
  attempts: string[]
}

/** 階数は「3」「3;4」「地上5」など揺れるので、数字として読めるときだけ使う */
function toLevels(value: string | undefined): number | null {
  if (!value) return null
  const n = Number(String(value).match(/\d+/)?.[0])
  return Number.isInteger(n) && n > 0 && n < 200 ? n : null
}

/**
 * 問い合わせ文。
 *
 * 2通りで拾う。
 *   1. 住まいの building（apartments など）… 名前が無くても拾う
 *   2. 名前の付いた building … マンションが building=yes で入っていることが
 *      多いので、ここを落とすと肝心のものが出てこない
 */
function buildQuery(bounds: Bounds): string {
  const box = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`
  const wide = expandBounds(bounds, FACILITY_MARGIN)
  const fbox = `${wide.south},${wide.west},${wide.north},${wide.east}`
  const homes = 'apartments|residential|dormitory|house|detached|semidetached_house|terrace'
  return [
    '[out:json][timeout:20];',
    '(',
    `  way["building"~"${homes}"](${box});`,
    `  relation["building"~"${homes}"](${box});`,
    `  way["building"]["name"](${box});`,
    `  relation["building"]["name"](${box});`,
    ');',
    `out tags center ${MAX_ELEMENTS};`,
    // まわりの施設（0077）。建物より広い四角で聞く。範囲のふちに建つ建物は、
    // 外にある店がいちばん近いことがある
    '(',
    `  nwr["shop"~"^(convenience|chemist)$"](${fbox});`,
    `  nwr["amenity"~"^(pharmacy|dentist|clinic|doctors)$"](${fbox});`,
    ');',
    `out tags center ${MAX_FACILITIES};`,
  ].join('\n')
}

/**
 * 施設の種類を決める（0077）。
 *
 * タグだけでは決まらないので、名前も見る。日本のクリニックは
 * healthcare:speciality が入っていないことが多く、代わりに名前に
 * 「内科」「歯科」と書いてある。
 *
 * 風邪で行くところを探しているので、専門科だけの医院は外す。皮膚科や
 * 眼科に風邪では行かない。
 */
export function facilityKind(tags: Record<string, string>): FacilityKind | null {
  const name = tags['name:ja'] || tags.name || ''
  // 動物病院は人が診てもらえない
  if (/動物|ペット|獣医/.test(name)) return null

  if (tags.shop === 'convenience') return 'convenience'
  if (tags.amenity === 'pharmacy' || tags.shop === 'chemist') return 'pharmacy'
  if (tags.amenity === 'dentist' || /歯科|デンタル/.test(name)) return 'dentist'

  if (tags.amenity === 'clinic' || tags.amenity === 'doctors') {
    const spec = tags['healthcare:speciality'] ?? ''
    if (spec && !/internal|general|paediatrics|community/.test(spec)) return null
    if (!spec && /科/.test(name) && !/内科|総合|一般|小児/.test(name)) return null
    return 'clinic'
  }

  return null
}

/**
 * 範囲の中の建物を取る。
 *
 * 取れなくても例外にはしない。Google 側だけでも一覧は出せるので、ここで
 * 画面を止める必要は無い。代わりに、どこで何が起きたかを attempts に残す。
 */
export async function fetchOsmBuildings(
  bounds: Bounds,
  stations: RentStation[]
): Promise<OsmResult> {
  const query = buildQuery(bounds)
  const attempts: string[] = []

  for (const endpoint of ENDPOINTS) {
    let res: Response | null = null
    try {
      res = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          // 公開サーバーの決まり。誰が呼んでいるか分かるようにしておく
          'user-agent': 'MarineWallet/1.0 (rent search; personal use)',
        },
        body: new URLSearchParams({ data: query }).toString(),
        cache: 'no-store',
        signal: AbortSignal.timeout(endpoint.ms),
      })
    } catch (e) {
      attempts.push(`OSM ${endpoint.host}: ${failReason(e)}`)
      continue
    }

    if (!res.ok) {
      attempts.push(`OSM ${endpoint.host}: HTTP ${res.status}`)
      continue
    }

    const body = (await res.json().catch(() => null)) as { elements?: OverpassElement[] } | null
    if (!body) {
      attempts.push(`OSM ${endpoint.host}: 返事を読めず`)
      continue
    }

    const buildings: RentBuilding[] = []
    const facilities: Facility[] = []

    for (const e of body.elements ?? []) {
      const tags = e.tags ?? {}
      // 施設かどうかを先に見る。薬局の入っている建物を住まいとして
      // 並べても仕方がない
      const kind = facilityKind(tags)
      if (kind) {
        const point = pointOf(e)
        if (point) {
          facilities.push({
            id: `f-${e.type ?? 'node'}-${e.id ?? 0}`,
            kind,
            name: (tags['name:ja'] || tags.name || '').trim(),
            ...point,
          })
        }
        continue
      }
      if (!tags.building || !isHome(tags)) continue
      const building = toBuilding(e, stations)
      if (building) buildings.push(building)
    }

    attempts.push(`OSM ${endpoint.host}: 建物${buildings.length}件・施設${facilities.length}件`)
    return { buildings, facilities, attempts }
  }

  return { buildings: null, facilities: [], attempts }
}

/** 点の位置。way と relation は center、node はそのまま */
function pointOf(e: OverpassElement): { lat: number; lng: number } | null {
  const lat = e.center?.lat ?? e.lat
  const lng = e.center?.lon ?? e.lon
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat: lat as number, lng: lng as number }
}

/** 住まいとして出してよいか。店や事務所は落とす */
function isHome(tags: Record<string, string>): boolean {
  if (NOT_HOMES.some((key) => tags[key])) return false
  const value = tags.building ?? ''
  if (KIND_LABELS[value]) return true
  // 名前で拾ったぶん。倉庫・駐車場・学校などは出さない
  return !['garage', 'garages', 'roof', 'shed', 'hut', 'school', 'church', 'train_station'].includes(
    value
  )
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
    kind: KIND_LABELS[tags.building ?? ''] ?? '建物',
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
