import { NextResponse } from 'next/server'

import { getSessionUser } from '@/lib/queries'
import { spendApiCall } from '@/lib/api-budget'
import { lookupPlaces } from '@/lib/places-google'
import { classifyPlace } from '@/lib/places-types'
import type { PlaceKind } from '@/types'

/**
 * 店や観光地を名前で探す（Places API / Text Search）。
 *
 * 打つたびに候補を出す形（オートコンプリート）にはしない。1文字ごとに
 * 呼ぶことになり、回数が読めない。検索を押したときに1回だけ呼ぶ。
 *
 * 名前・住所・座標に加えて、種別とジャンルも持ち帰る。飲食店なのか、
 * 寿司なのかラーメンなのかは Google がすでに持っていて、登録する人が
 * 入れ直す必要が無い（0051）。種類は名前・住所と同じ区分なので、
 * 足しても費用は増えない。
 *
 * 鍵はサーバー側だけで使う。Geocoding と同じ鍵を使うので、Google Cloud
 * 側でその鍵に Places API (New) を足しておく必要がある。
 */
export const dynamic = 'force-dynamic'

export type PlaceHit = {
  name: string
  address: string
  lat: number
  lng: number
  /** Google の種類から決めた種別。決まらなければ null */
  kind: PlaceKind | null
  /** Google の種類から決めたジャンル。飲食のときだけ入る */
  genres: string[]
}

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!key) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  const { query } = (await request.json().catch(() => ({}))) as { query?: string }
  const text = (query ?? '').trim()
  if (text.length < 2) return NextResponse.json({ hits: [] })

  const spend = await spendApiCall('places_search')
  if (!spend.allowed) {
    return NextResponse.json({ error: 'over_budget' }, { status: 429 })
  }

  const found = await lookupPlaces(key, text, 5)
  if (!found) return NextResponse.json({ error: 'search_failed' }, { status: 502 })

  const hits: PlaceHit[] = found
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => ({
      name: p.name,
      address: p.address,
      lat: p.lat,
      lng: p.lng,
      ...classifyPlace(p.primaryType, p.types, p.typeLabel),
    }))

  return NextResponse.json({ hits })
}
