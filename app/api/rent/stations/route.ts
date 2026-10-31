import { NextResponse } from 'next/server'

import { spendApiCall } from '@/lib/api-budget'
import { lookupPlaces } from '@/lib/places-google'
import { getProfile, getSessionUser } from '@/lib/queries'
import { fetchLineByName } from '@/lib/rent-lines'
import { fetchStationLine } from '@/lib/rent-osm'

/**
 * 駅を名前で探す（0075）。
 *
 * 駅のデータは持たない。全国ぶんを抱えると更新が止まるし、路線が増えるたび
 * 入れ直すことになる。すでに使っている Places にそのまま聞く。
 *
 * 打つたびには呼ばない。検索を押したときに1回だけ呼ぶ（places_search と
 * 同じ数え方）。1文字ごとに呼ぶと、回数が読めない。
 *
 * master だけの機能。画面でも入口を出していないが、URL を直に叩かれる
 * ことはあるので、ここでも見る。
 */
export const dynamic = 'force-dynamic'

export type StationHit = {
  name: string
  address: string
  lat: number
  lng: number
  /** 路線名（0085）。OSM から引く。取れなければ空 */
  line?: string
}

/** Google の種類のうち、駅として扱うもの */
const STATION_TYPES = [
  'train_station',
  'subway_station',
  'light_rail_station',
  'transit_station',
  'bus_station',
]

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const profile = await getProfile(user.id)
  if (!profile?.is_master) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const key = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!key) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  const { query } = (await request.json().catch(() => ({}))) as { query?: string }
  const text = (query ?? '').trim()
  if (text.length < 1) return NextResponse.json({ hits: [] })

  const spend = await spendApiCall('places_search')
  if (!spend.allowed) return NextResponse.json({ error: 'over_budget' }, { status: 429 })

  // 「駅」を足して聞く。「恵比寿」だけだと店や地名が先に並ぶ
  const found = await lookupPlaces(key, /駅$/.test(text) ? text : `${text}駅`, 10)
  if (!found) return NextResponse.json({ error: 'search_failed' }, { status: 502 })

  const hits: StationHit[] = found
    .filter((p) => p.types.some((t) => STATION_TYPES.includes(t)))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => ({ name: p.name, address: p.address, lat: p.lat, lng: p.lng }))
    .slice(0, 6)

  /**
   * 路線名を足す（0085）。
   *
   * Google は路線を持っていないので OSM に聞く。小さな問い合わせなので
   * まとめて投げる。取れなければ駅名だけで使う。ここで待たせたくないので、
   * 候補は6件までにしてある。
   */
  const lines = await Promise.all(hits.map((hit) => lineOf(hit.name, hit)))
  lines.forEach((found, index) => {
    if (found.line) hits[index].line = found.line
  })

  // 1件も届かなかったときだけ知らせる。路線名が無いのと、取りに行けな
  // かったのとでは、見るほうの読み取りが変わる
  const reached = lines.some((found) => found.reached)
  return NextResponse.json({ hits, lineNote: reached ? null : '路線名を取れませんでした' })
}

/**
 * 路線名を1つ取る（0089）。
 *
 * 駅データの API を先に試し、届かなければ OSM に回す。外の1か所に頼ると、
 * そこが落ちた日に何も出なくなる。
 */
async function lineOf(
  name: string,
  point: { lat: number; lng: number }
): Promise<{ line: string | null; reached: boolean }> {
  const byName = await fetchLineByName(name, point).catch(() => ({
    line: null,
    reached: false,
  }))
  if (byName.line) return byName

  const byMap = await fetchStationLine(point).catch(() => ({ line: null, reached: false }))
  return { line: byMap.line, reached: byName.reached || byMap.reached }
}
