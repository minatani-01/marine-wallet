/**
 * 場所の座標を引く（Google Geocoding API）。
 *
 * 正本は名前と場所（name / area）で、座標はそこから引いた写しにすぎない。
 * 引くのは保存したときの1回だけにする。地図を開くたびに引くと、
 * 無料の範囲（月10,000回）を個人利用でも使い切りかねない。
 *
 * 鍵はサーバー側だけで使う。ブラウザへ出す鍵は参照元で縛れるが、
 * Geocoding はブラウザから呼ばないので、そもそも出さない。
 */

export type GeoPoint = { lat: number; lng: number }

/** 座標を引くときの検索文字列。名前だけだと同名の別店舗に当たる */
export function geocodeQuery(place: { name: string; area: string }): string {
  return [place.area, place.name].filter(Boolean).join(' ').trim()
}

export function geocodeConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_SERVER_KEY)
}

/**
 * 1件ぶん引く。引けなければ null。
 *
 * 引けないことは珍しくない（新しい店、通称、建物名だけ）。そのときは
 * 地図に出ないだけで、リンクからは開けるので、失敗しても保存は止めない。
 */
export async function geocode(query: string): Promise<GeoPoint | null> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!key || !query) return null

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('address', query)
  url.searchParams.set('language', 'ja')
  // 日本の中から探す。同じ名前の海外の地名に飛ばさない
  url.searchParams.set('region', 'jp')
  url.searchParams.set('components', 'country:JP')
  url.searchParams.set('key', key)

  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) return null

  const body = (await res.json()) as {
    status?: string
    results?: { geometry?: { location?: { lat?: number; lng?: number } } }[]
  }
  if (body.status !== 'OK') return null

  const point = body.results?.[0]?.geometry?.location
  if (typeof point?.lat !== 'number' || typeof point?.lng !== 'number') return null

  return { lat: point.lat, lng: point.lng }
}
