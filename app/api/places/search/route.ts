import { NextResponse } from 'next/server'

import { getSessionUser } from '@/lib/queries'
import { spendApiCall } from '@/lib/api-budget'

/**
 * 店や観光地を名前で探す（Places API / Text Search）。
 *
 * 打つたびに候補を出す形（オートコンプリート）にはしない。1文字ごとに
 * 呼ぶことになり、回数が読めない。検索を押したときに1回だけ呼ぶ。
 *
 * 受け取るのは名前・住所・座標の3つだけ。欲しい項目を絞ると安い区分で
 * 済み、余計な情報も持ち帰らない。
 *
 * 鍵はサーバー側だけで使う。Geocoding と同じ鍵を使うので、Google Cloud
 * 側でその鍵に Places API (New) を足しておく必要がある。
 */
export const dynamic = 'force-dynamic'

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'
const FIELDS = 'places.displayName,places.formattedAddress,places.location'

export type PlaceHit = {
  name: string
  address: string
  lat: number
  lng: number
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

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': FIELDS,
    },
    body: JSON.stringify({
      textQuery: text,
      languageCode: 'ja',
      regionCode: 'JP',
      maxResultCount: 5,
    }),
    cache: 'no-store',
  }).catch(() => null)

  if (!res || !res.ok) {
    return NextResponse.json({ error: 'search_failed' }, { status: 502 })
  }

  const body = (await res.json().catch(() => null)) as {
    places?: {
      displayName?: { text?: string }
      formattedAddress?: string
      location?: { latitude?: number; longitude?: number }
    }[]
  } | null

  const hits: PlaceHit[] = (body?.places ?? [])
    .map((p) => ({
      name: p.displayName?.text ?? '',
      // 郵便番号は場所の手がかりとしては邪魔なので落とす
      address: (p.formattedAddress ?? '').replace(/^〒\d{3}-?\d{4}\s*/, ''),
      lat: p.location?.latitude ?? Number.NaN,
      lng: p.location?.longitude ?? Number.NaN,
    }))
    .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng))

  return NextResponse.json({ hits })
}
