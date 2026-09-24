/**
 * Google の Places API（Text Search）を1回呼ぶ。
 *
 * 検索の画面からも、あとから種別・ジャンルを取り込むときからも同じ形で
 * 呼びたいので、ここにまとめる。数を数えて止めるのは呼ぶ側の仕事にしてある
 * （画面はログイン中の本人、Cron は管理者として数えるため）。
 *
 * 受け取る項目は Pro の区分にそろえてある。種類（types / primaryType /
 * primaryTypeDisplayName）は名前・住所・座標と同じ区分なので、
 * 足しても費用は増えない。値段（priceLevel）はひとつ上の区分なので取らない。
 */

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'

export const PLACE_FIELDS = [
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.businessStatus',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.types',
].join(',')

export type GooglePlace = {
  name: string
  address: string
  lat: number
  lng: number
  status: string
  primaryType: string
  typeLabel: string
  types: string[]
}

type RawPlace = {
  displayName?: { text?: string }
  formattedAddress?: string
  location?: { latitude?: number; longitude?: number }
  businessStatus?: string
  primaryType?: string
  primaryTypeDisplayName?: { text?: string }
  types?: string[]
}

/**
 * 名前で探す。呼び出し1回ぶんの上限確認は呼ぶ側で済ませておくこと。
 *
 * 失敗しても例外にはしない。座標もジャンルも「引けなかった」で済む話で、
 * 画面の操作を止めるほどのことではない。
 */
export async function lookupPlaces(
  key: string,
  query: string,
  max = 5
): Promise<GooglePlace[] | null> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': PLACE_FIELDS,
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: 'ja',
      regionCode: 'JP',
      maxResultCount: max,
    }),
    cache: 'no-store',
  }).catch(() => null)

  if (!res || !res.ok) return null

  const body = (await res.json().catch(() => null)) as { places?: RawPlace[] } | null
  if (!body) return null

  return (body.places ?? [])
    .map((p) => ({
      name: p.displayName?.text ?? '',
      // 郵便番号は場所の手がかりとしては邪魔なので落とす
      address: (p.formattedAddress ?? '').replace(/^〒\d{3}-?\d{4}\s*/, ''),
      lat: p.location?.latitude ?? Number.NaN,
      lng: p.location?.longitude ?? Number.NaN,
      status: p.businessStatus ?? '',
      primaryType: p.primaryType ?? '',
      typeLabel: p.primaryTypeDisplayName?.text ?? '',
      types: p.types ?? [],
    }))
    .filter((p) => p.name)
}
