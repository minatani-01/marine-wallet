import { NextResponse } from 'next/server'

import { spendApiCall } from '@/lib/api-budget'
import { getProfile, getSessionUser } from '@/lib/queries'
import { findStation, geocodeStation } from '@/lib/rent-google'
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

  /**
   * 引く順（0094）。
   *   1. Geocoding … 別の割り当てで単価も安い。駅名 → 座標ならこれで足りる
   *   2. Places（都内優先） … Geocoding が駅として返さなかったとき
   *   3. Places（優先なし） … 優先の付け方で断られたとき
   * どこで止まったかを reason に残し、駄目なら画面に出す。
   */
  const reasons: string[] = []
  let hit: { lat: number; lng: number } | null = null

  const geo = await spendApiCall('geocoding')
  if (geo.allowed) {
    const found = await geocodeStation(key, row.name)
    reasons.push(found.reason)
    hit = found.hit
  } else {
    reasons.push(`Geocoding: 今日は上限（${geo.used_today}/${geo.daily}）`)
  }

  if (!hit) {
    const spend = await spendApiCall('places_search')
    if (!spend.allowed) {
      return NextResponse.json(
        { error: 'over_budget', reason: [...reasons, 'Places: 今日は上限'].join(' / ') },
        { status: 429 }
      )
    }
    let found = await findStation(key, row.name, TOKYO)
    if (!found.hit) found = await findStation(key, row.name)
    reasons.push(found.reason)
    hit = found.hit
  }

  if (!hit) {
    return NextResponse.json({ error: 'not_found', reason: reasons.join(' / ') }, { status: 502 })
  }

  // 書き戻す。失敗しても今回の座標は返す（次回また引けばよい）
  await supabase
    .from('rent_stations')
    .update({ lat: hit.lat, lng: hit.lng, resolved_at: new Date().toISOString() })
    .eq('id', row.id)

  return NextResponse.json({ lat: hit.lat, lng: hit.lng, cached: false })
}
