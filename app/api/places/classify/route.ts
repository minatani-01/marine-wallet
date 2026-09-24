import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { getSessionUser } from '@/lib/queries'
import { spendApiCall } from '@/lib/api-budget'
import { lookupPlaces } from '@/lib/places-google'
import { classificationPatch } from '@/lib/places-types'
import { checkQuery, sameShop } from '@/lib/places-status'

/**
 * すでに登録してある場所の種別・ジャンルを Google から取り込む（0051）。
 *
 * 保存リストの取り込みでは「全部まとめて飲食」としか入れられず、観光地も
 * 飲食に混ざる。ジャンルも空のままになる。1件ずつ直すのは続かないので、
 * あとからまとめて取り込めるようにする。
 *
 * 1回の呼び出しで1件だけ見る。画面が何件ぶん押すかを決め、上限に当たったら
 * そこで止める。まとめて何十件も投げると、その日の上限を使い切ってしまう。
 *
 * 同じ店だと言い切れないときは何も書かない。名前で探しているので別の店が
 * 返ることがあり、そのまま書くと無関係の店のジャンルが付く（0045 と同じ考え方）。
 * それでも「見た」ことは残す。返ってこないものを毎回問い合わせ直さない。
 */
export const dynamic = 'force-dynamic'

type Row = {
  id: string
  name: string
  area: string
  kind: string
  genres: string[]
}

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!key) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  const { id } = (await request.json().catch(() => ({}))) as { id?: string }
  if (!id) return NextResponse.json({ error: 'id がありません' }, { status: 400 })

  const supabase = await createClient()
  const { data: place } = await supabase
    .from('places')
    .select('id, name, area, kind, genres')
    .eq('id', id)
    .maybeSingle<Row>()

  if (!place) return NextResponse.json({ error: '見つかりません' }, { status: 404 })

  const spend = await spendApiCall('places_search')
  if (!spend.allowed) {
    return NextResponse.json(
      { ok: false, reason: 'over_budget', used_today: spend.used_today, daily: spend.daily },
      { status: 429 }
    )
  }

  const now = new Date().toISOString()
  const found = await lookupPlaces(key, checkQuery(place), 1)

  // 聞けなかっただけのときは印を付けない。付けてしまうと、次に押したときの
  // 対象から外れ、何も分からないまま「取り込み済み」になる
  if (found === null) {
    return NextResponse.json({ ok: false, reason: 'search_failed' }, { status: 502 })
  }

  const hit = found[0] ?? null

  if (!hit || !sameShop(place.name, hit.name)) {
    // 見つからなかったことも残す。次に名前を直すまで問い合わせ直さない
    await supabase.from('places').update({ types_checked_at: now }).eq('id', id)
    return NextResponse.json({ ok: false, reason: 'not_found' })
  }

  const patch = classificationPatch(place, hit.primaryType, hit.types, hit.typeLabel)

  const { error } = await supabase
    .from('places')
    .update({ ...patch, types_checked_at: now })
    .eq('id', id)
  if (error) return NextResponse.json({ ok: false, reason: 'save_failed' }, { status: 500 })

  return NextResponse.json({ ok: true, kind: patch.kind ?? place.kind, genres: patch.genres })
}
