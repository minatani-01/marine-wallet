import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { getSessionUser } from '@/lib/queries'
import { geocode, geocodeConfigured, geocodeQuery } from '@/lib/geocode'
import { spendApiCall } from '@/lib/api-budget'

/**
 * 場所の座標を引いて保存する。
 *
 * 保存や編集の直後に、その1件だけを引く。地図を開くたびには引かない。
 * 引けなくても呼び出し側は困らない（地図に出ないだけで、リンクからは開ける）。
 *
 * 書き込みはログイン中の本人として行う。RLS が「貯金を共にしている人」
 * だけを通すので、他人のリストは触れない。
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  if (!geocodeConfigured()) {
    return NextResponse.json({ error: '地図の鍵が設定されていません' }, { status: 503 })
  }

  const { id } = (await request.json().catch(() => ({}))) as { id?: string }
  if (!id) return NextResponse.json({ error: 'id がありません' }, { status: 400 })

  const supabase = await createClient()
  const { data: place } = await supabase
    .from('places')
    .select('id, name, area, geocoded_query, lat')
    .eq('id', id)
    .maybeSingle()

  if (!place) return NextResponse.json({ error: '見つかりません' }, { status: 404 })

  const query = geocodeQuery(place)
  // 同じ文字列で引いた座標があるなら、もう一度払う理由が無い
  if (place.lat !== null && place.geocoded_query === query) {
    return NextResponse.json({ ok: true, cached: true })
  }

  // 上限に達していたら呼ばない。座標が無いだけで、保存は済んでいる
  const spend = await spendApiCall('geocoding')
  if (!spend.allowed) {
    return NextResponse.json(
      { ok: false, reason: 'over_budget', used_today: spend.used_today, daily: spend.daily },
      { status: 429 }
    )
  }

  const point = await geocode(query)
  if (!point) {
    // 引けなかったことも残す。次に名前を直すまで引き直さない
    await supabase
      .from('places')
      .update({ lat: null, lng: null, geocoded_at: new Date().toISOString(), geocoded_query: query })
      .eq('id', id)
    return NextResponse.json({ ok: false, reason: 'not_found' })
  }

  await supabase
    .from('places')
    .update({
      lat: point.lat,
      lng: point.lng,
      geocoded_at: new Date().toISOString(),
      geocoded_query: query,
    })
    .eq('id', id)

  return NextResponse.json({ ok: true, ...point })
}
