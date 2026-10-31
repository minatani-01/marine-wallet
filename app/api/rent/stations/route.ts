import { NextResponse } from 'next/server'

import { spendApiCall } from '@/lib/api-budget'
import { lookupPlaces } from '@/lib/places-google'
import { getProfile, getSessionUser } from '@/lib/queries'
import { createClient } from '@/lib/supabase/server'
import type { RentStationRow } from '@/types'

/**
 * 登録してある駅の座標を引く（0092）。
 *
 * 駅は rent_stations に登録したものから選ぶ。座標は空で登録してあり、
 * 初めて選ばれたときにここで Google に1回だけ聞いて書き戻す。手で入れた
 * 座標は数百 m ずれることがあり、徒歩◯分の円がずれる。1回引いたあとは
 * 外に出ない。
 *
 * master だけの機能。画面でも入口を出していないが、URL を直に叩かれる
 * ことはあるので、ここでも見る。
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** Google の種類のうち、駅として扱うもの */
const STATION_TYPES = [
  'train_station',
  'subway_station',
  'light_rail_station',
  'transit_station',
  'bus_station',
]

/**
 * 都内を優先して引く。同じ名前の駅は全国にある（大手町は愛媛にも、
 * 中野は長野にもある）。登録してあるのは都内の駅なので、ここを先に見る
 */
const TOKYO = { lat: 35.68, lng: 139.75, radius: 40_000 }

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const profile = await getProfile(user.id)
  if (!profile?.is_master) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { id } = (await request.json().catch(() => ({}))) as { id?: string }
  if (!id) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const supabase = await createClient()
  const { data: row } = await supabase
    .from('rent_stations')
    .select('id, line, name, lat, lng')
    .eq('id', id)
    .maybeSingle<RentStationRow>()
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // もう引いてあればそれを返す。ここが本来の道で、外には出ない
  if (row.lat != null && row.lng != null) {
    return NextResponse.json({ lat: row.lat, lng: row.lng, cached: true })
  }

  const key = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!key) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  const spend = await spendApiCall('places_search')
  if (!spend.allowed) return NextResponse.json({ error: 'over_budget' }, { status: 429 })

  const found = await lookupPlaces(key, row.name, 5, TOKYO)
  if (!found) return NextResponse.json({ error: 'search_failed' }, { status: 502 })

  const stations = found.filter(
    (p) => p.types.some((t) => STATION_TYPES.includes(t)) && Number.isFinite(p.lat)
  )
  // 名前がぴったり合うものを先に。「御徒町駅」で「上野御徒町駅」を採らない
  const hit = stations.find((p) => p.name === row.name) ?? stations[0]
  if (!hit) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // 書き戻す。失敗しても今回の座標は返す（次回また引けばよい）
  await supabase
    .from('rent_stations')
    .update({ lat: hit.lat, lng: hit.lng, resolved_at: new Date().toISOString() })
    .eq('id', row.id)

  return NextResponse.json({ lat: hit.lat, lng: hit.lng, cached: false })
}
