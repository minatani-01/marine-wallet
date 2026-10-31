import { NextResponse } from 'next/server'

import { getProfile, getSessionUser } from '@/lib/queries'
import { MAX_RENT_STATIONS, type RentPoint } from '@/lib/rent'
import { fetchLineByName } from '@/lib/rent-lines'
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

  const body = (await request.json().catch(() => ({}))) as {
    points?: (RentPoint & { name?: string })[]
  }
  const points = (body.points ?? [])
    .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng), name: String(p.name ?? '') }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .slice(0, MAX_RENT_STATIONS)

  if (points.length === 0) return NextResponse.json({ lines: [] })

  // 駅データの API を先に、届かなければ OSM（0089）
  const found = await Promise.all(
    points.map(async (p) => {
      const byName = p.name
        ? await fetchLineByName(p.name, p).catch(() => ({ line: null, reached: false }))
        : { line: null, reached: false }
      if (byName.line) return byName

      const byMap = await fetchStationLine(p).catch(() => ({ line: null, reached: false }))
      return { line: byMap.line, reached: byName.reached || byMap.reached }
    })
  )

  return NextResponse.json({
    lines: found.map((f) => f.line),
    lineNote: found.some((f) => f.reached) ? null : '路線名を取れませんでした',
  })
}
