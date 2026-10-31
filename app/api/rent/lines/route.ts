import { NextResponse } from 'next/server'

import { getProfile, getSessionUser } from '@/lib/queries'
import { MAX_RENT_STATIONS, type RentPoint } from '@/lib/rent'
import { fetchStationLine } from '@/lib/rent-osm'

/**
 * 入れてある駅の路線名を取り直す（0086）。
 *
 * 路線名が付く前に入れた駅は、名前だけのまま端末に残っている。開くたびに
 * 自分で入れ直させるのも、路線名の無い駅が並び続けるのも具合が悪いので、
 * 足りないぶんだけここで取り直す。
 *
 * 出どころは OpenStreetMap で、費用はかからない。取れなくても困らない
 * （駅名だけで使える）ので、失敗は理由だけ返して終わる。
 *
 * master だけの機能。画面に出していなくても、URL は叩ける。
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const profile = await getProfile(user.id)
  if (!profile?.is_master) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => ({}))) as { points?: RentPoint[] }
  const points = (body.points ?? [])
    .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .slice(0, MAX_RENT_STATIONS)

  if (points.length === 0) return NextResponse.json({ lines: [] })

  const found = await Promise.all(
    points.map((p) => fetchStationLine(p).catch(() => ({ line: null, reached: false })))
  )

  return NextResponse.json({
    lines: found.map((f) => f.line),
    lineNote: found.some((f) => f.reached) ? null : '路線名を取れませんでした',
  })
}
