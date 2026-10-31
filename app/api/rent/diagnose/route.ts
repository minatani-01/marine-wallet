import { spendApiCalls } from '@/lib/api-budget'
import { getProfile, getSessionUser } from '@/lib/queries'
import { searchHousing, walkMatrix } from '@/lib/rent-google'

/**
 * 賃貸さがしの通信を1つずつ試す（0088）。
 *
 * 建物も施設も路線名も、取れない原因が外の相手にあるのか、こちらの作りに
 * あるのかが画面からは分からない。検索の結果に紛れさせず、ここだけ見れば
 * どこが通っていないかが分かるようにする。
 *
 * ブラウザでそのまま開けるよう、返すのはただの文字にする。master だけ。
 *
 * Google は1回ぶん使うので、数えてから呼ぶ。Overpass は無料なので数えない。
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** 東京駅のあたり。どこでもよいが、建物も店もある場所にする */
const HERE = { lat: 35.681236, lng: 139.767125 }

const OVERPASS = [
  { host: 'overpass.osm.jp', url: 'https://overpass.osm.jp/api/interpreter' },
  { host: 'overpass-api.de', url: 'https://overpass-api.de/api/interpreter' },
  { host: 'overpass.kumi.systems', url: 'https://overpass.kumi.systems/api/interpreter' },
  { host: 'overpass.private.coffee', url: 'https://overpass.private.coffee/api/interpreter' },
]

/** ごく小さな問い合わせ。混み具合ではなく、届くかどうかを見る */
const PROBE = '[out:json][timeout:10];node(around:150,35.681236,139.767125)["railway"];out ids 3;'

function seconds(from: number): string {
  return `${((Date.now() - from) / 1000).toFixed(1)}秒`
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) return new Response('ログインしてください', { status: 401 })

  const profile = await getProfile(user.id)
  if (!profile?.is_master) return new Response('master だけが見られます', { status: 403 })

  const lines: string[] = ['賃貸さがし 接続テスト', '']

  // ------------------------------------------------------------------
  // OpenStreetMap（建物・施設・路線名）
  // ------------------------------------------------------------------
  lines.push('[ OpenStreetMap ] 建物・まわりの施設・路線名')
  for (const endpoint of OVERPASS) {
    const started = Date.now()
    try {
      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': 'MarineWallet/1.0 (rent search; personal use)',
        },
        body: new URLSearchParams({ data: PROBE }).toString(),
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) {
        lines.push(`  ${endpoint.host}: HTTP ${res.status} (${seconds(started)})`)
        continue
      }
      const body = (await res.json().catch(() => null)) as { elements?: unknown[] } | null
      lines.push(`  ${endpoint.host}: OK ${body?.elements?.length ?? 0}件 (${seconds(started)})`)
    } catch (e) {
      const name = e instanceof Error ? e.name : 'error'
      const cause = (e as { cause?: unknown })?.cause
      const why = cause instanceof Error ? cause.message : (e as Error)?.message
      lines.push(`  ${endpoint.host}: ${name} ${String(why).slice(0, 60)} (${seconds(started)})`)
    }
  }

  // ------------------------------------------------------------------
  // Google（建物名・飲食店・徒歩時間）
  // ------------------------------------------------------------------
  lines.push('')
  lines.push('[ Google ] 建物名・飲食店・徒歩時間')
  const key = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!key) {
    lines.push('  鍵（GOOGLE_MAPS_SERVER_KEY）が設定されていません')
  } else {
    lines.push('  鍵: あり')

    const spend = await spendApiCalls('places_nearby', 1)
    if (!spend.allowed) {
      lines.push(`  Places: 今日の上限 (${spend.used_today}/${spend.daily})`)
    } else {
      const started = Date.now()
      const found = await searchHousing(key, HERE, 400, [])
      for (const attempt of found.attempts) lines.push(`  Places ${attempt} (${seconds(started)})`)
    }

    const routes = await spendApiCalls('routes_walk', 1)
    if (!routes.allowed) {
      lines.push(`  Routes: 今日の上限 (${routes.used_today}/${routes.daily})`)
    } else {
      const started = Date.now()
      const matrix = await walkMatrix(key, [HERE], [{ lat: 35.6854, lng: 139.7531 }])
      lines.push(`  Routes ${matrix.attempt} (${seconds(started)})`)
    }
  }

  lines.push('')
  lines.push('OK が1つも無い行があれば、そこが通っていません。')

  return new Response(lines.join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}
