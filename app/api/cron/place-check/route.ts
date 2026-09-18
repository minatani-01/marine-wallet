import { NextResponse } from 'next/server'

import { spendApiCall } from '@/lib/api-budget'
import { checkQuery, dueBefore, statusFromHit } from '@/lib/places-status'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * 飲食店が閉店していないかの確認。
 *
 * 個人経営の店は黙って閉まる。行きたいリストに残しておくと、
 * 出かけた先で初めて気付くことになる。Google の持っている営業状態を
 * 月に1回くらいの間隔で見に行き、閉まっていたら印を付ける。
 *
 * 消しはしない。閉店かどうかの判断は Google のほうが間違えることもあるし、
 * 「行った場所」の記録は店が無くなっても残しておきたい。
 * 画面で色を落として「閉店」と出すところまでにして、消すかどうかは人が決める。
 *
 * 呼ばれるのは毎日だが、確認するのは前回から25日以上経ったものだけ。
 * 1回あたり5件に抑えてある。店が増えても1日の呼び出し数は変わらず、
 * 1店あたりの間隔が伸びるだけなので、費用が膨らむことがない。
 *
 * 観光地は見に行かない。公園や城が閉店することはまずなく、
 * 呼ぶだけ無駄になる。
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'
// businessStatus を含めても、いま検索で使っている区分と同じ。増える費用は無い
const FIELDS = 'places.displayName,places.businessStatus'

/** 1回に確認する件数。places_search の1日の上限（50回）に対して十分低く取る */
const BATCH = 5

type PlaceRow = {
  id: string
  name: string
  area: string
  business_status: string
}

/** Vercel Cron は Authorization: Bearer <CRON_SECRET> を付けて呼ぶ */
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

/** Google に1件だけ聞く。答えられなければ null（状態には触らない） */
async function askGoogle(
  key: string,
  query: string
): Promise<{ name: string; status: string } | null> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': FIELDS,
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: 'ja',
      regionCode: 'JP',
      maxResultCount: 1,
    }),
    cache: 'no-store',
  }).catch(() => null)

  if (!res || !res.ok) return null

  const body = (await res.json().catch(() => null)) as {
    places?: { displayName?: { text?: string }; businessStatus?: string }[]
  } | null

  const first = body?.places?.[0]
  if (!first) return null
  return { name: first.displayName?.text ?? '', status: first.businessStatus ?? '' }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    // 設定漏れと不正なアクセスを区別しない。存在を教えないため
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const key = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!key) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  let supabase: ReturnType<typeof createAdminClient>
  try {
    supabase = createAdminClient()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }

  const now = new Date()
  const cutoff = dueBefore(now)

  const { data, error } = await supabase
    .from('places')
    .select('id, name, area, business_status')
    .eq('kind', 'food')
    .or(`status_checked_at.is.null,status_checked_at.lt.${cutoff}`)
    // 長く見ていないものから。件数が増えても順に回っていく
    .order('status_checked_at', { ascending: true, nullsFirst: true })
    .limit(BATCH)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const places = (data ?? []) as PlaceRow[]
  const closed: string[] = []
  let checked = 0
  let unknown = 0
  let overBudget = false

  for (const place of places) {
    const query = checkQuery(place)
    if (!query) continue

    const spend = await spendApiCall('places_search', supabase)
    if (!spend.allowed) {
      // 上限に達したら、その日はここで止める。残りは次の日に回る
      overBudget = true
      break
    }

    const hit = await askGoogle(key, query)
    const status = statusFromHit(place.name, hit)

    // 確かめた印は、同じ店だと分からなかったときも付ける。
    // 付けないと毎日同じ店を聞き直すことになり、回数だけ減る
    const patch: Record<string, string> = { status_checked_at: now.toISOString() }
    if (status) patch.business_status = status

    await supabase.from('places').update(patch).eq('id', place.id)

    checked += 1
    if (!status) unknown += 1
    if (status === 'CLOSED_PERMANENTLY' && place.business_status !== 'CLOSED_PERMANENTLY') {
      closed.push(place.name)
    }
  }

  return NextResponse.json({
    ok: true,
    due: places.length,
    checked,
    unknown,
    closed,
    overBudget,
  })
}
