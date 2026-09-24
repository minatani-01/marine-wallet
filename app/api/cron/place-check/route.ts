import { NextResponse } from 'next/server'

import { spendApiCall } from '@/lib/api-budget'
import { checkQuery, dueBefore, sameShop, statusFromHit } from '@/lib/places-status'
import { lookupPlaces } from '@/lib/places-google'
import { classificationPatch } from '@/lib/places-types'
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
 *
 * ついでに種別とジャンルも取り込む（0051）。同じ問い合わせで一緒に返って
 * くるうえ、種類は名前・営業状態と同じ区分にあるので、費用も回数も増えない。
 * 店の業態は変わる（居酒屋がラーメン屋になる）ので、月に1回見直されると
 * 手で直さなくても追いつく。
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** 1回に確認する件数。places_search の1日の上限（50回）に対して十分低く取る */
const BATCH = 5

type PlaceRow = {
  id: string
  name: string
  area: string
  kind: string
  genres: string[]
  business_status: string
}

/** Vercel Cron は Authorization: Bearer <CRON_SECRET> を付けて呼ぶ */
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
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
    .select('id, name, area, kind, genres, business_status')
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
  let classified = 0
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

    const found = await lookupPlaces(key, query, 1)
    const hit = found?.[0] ?? null
    const status = statusFromHit(place.name, hit)

    // 確かめた印は、同じ店だと分からなかったときも付ける。
    // 付けないと毎日同じ店を聞き直すことになり、回数だけ減る
    const patch: Record<string, unknown> = { status_checked_at: now.toISOString() }
    if (status) patch.business_status = status

    // 種別・ジャンルの印は、Google が答えたときだけ付ける。聞けなかった
    // だけで付けると、画面の「まとめて取り込む」の対象から永久に外れる
    if (found !== null) patch.types_checked_at = now.toISOString()

    // 種別とジャンルも同じ答えから取る。営業状態が読めたかどうかとは
    // 別に見る。営業状態を持たない場所（公園など）でも種類は返るので、
    // 「飲食として入っているが実は観光地」を直せる
    if (hit && sameShop(place.name, hit.name)) {
      const next = classificationPatch(place, hit.primaryType, hit.types, hit.typeLabel)
      const kindChanged = Boolean(next.kind && next.kind !== place.kind)
      const genresGrew = next.genres.length > place.genres.length
      if (kindChanged) patch.kind = next.kind
      if (genresGrew) patch.genres = next.genres
      if (kindChanged || genresGrew) classified += 1
    }

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
    classified,
    closed,
    overBudget,
  })
}
