/**
 * 駅の路線名を取る（0089）。
 *
 * Google は駅の名前と場所を返すが、路線は持っていない。はじめは OSM
 * （Overpass）に聞いていたが、本番から届かなかった。外の1か所に頼ると、
 * そこが落ちた日に何も出なくなる。
 *
 * そこで、駅データの API を先に試し、駄目なら OSM に回す。どちらも鍵も
 * 費用も要らない。両方だめでも駅名だけで探せるので、画面は止めない。
 *
 * - 駅データ（HeartRails Express）: 駅名で引くと、路線ごとに1件ずつ返る。
 *   「JR山手線」「東京メトロ銀座線」のように、人が呼ぶ名前で入っている。
 * - OSM: 駅の近くを通る route のまとまりから拾う（lib/rent-osm.ts）。
 */

import { haversine, type RentPoint } from '@/lib/rent'

const HEARTRAILS = 'https://express.heartrails.com/api/json'

/** 同じ駅とみなす距離。駅データと Google で代表点がずれることがある */
const SAME_STATION_M = 1500

type HeartRailsStation = {
  name?: string
  line?: string
  x?: number
  y?: number
}

/**
 * 駅データから路線名を取る。
 *
 * 名前で引いて、座標がいちばん近いものを採る。同じ名前の駅は全国にあるので
 * （中野・大手町など）、名前だけで決めると別の町の路線が出る。
 */
export async function fetchLineByName(
  name: string,
  point: RentPoint
): Promise<{ line: string | null; reached: boolean }> {
  // 「駅」を外して引く。駅データ側は「秋葉原」で入っている
  const key = name.replace(/駅$/, '').trim()
  if (!key) return { line: null, reached: false }

  const url = `${HEARTRAILS}?method=getStations&name=${encodeURIComponent(key)}`

  const res = await fetch(url, {
    headers: { 'user-agent': 'MarineWallet/1.0 (rent search; personal use)' },
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null)

  if (!res || !res.ok) return { line: null, reached: false }

  const body = (await res.json().catch(() => null)) as
    | { response?: { station?: HeartRailsStation[] } }
    | null
  if (!body) return { line: null, reached: false }

  const near = (body.response?.station ?? [])
    .map((s) => ({
      line: (s.line ?? '').trim(),
      meters:
        Number.isFinite(s.x) && Number.isFinite(s.y)
          ? haversine(point, { lat: s.y as number, lng: s.x as number })
          : Number.POSITIVE_INFINITY,
    }))
    .filter((s) => s.line && s.meters <= SAME_STATION_M)
    .sort((a, b) => a.meters - b.meters)

  // 届いてはいる。路線が見つからなくても、次を試す必要はない
  return { line: near[0]?.line ?? null, reached: true }
}
