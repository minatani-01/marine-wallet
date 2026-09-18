import { NextResponse } from 'next/server'

import { getSessionUser } from '@/lib/queries'
import { spendApiCall } from '@/lib/api-budget'

/**
 * 地図を描くための鍵を渡す。
 *
 * 鍵をページに埋め込まず、ここで1回ぶん数えてから渡す。埋め込むと
 * 読み込みの回数を数えられず、上限で止められない。
 *
 * 鍵そのものはブラウザに出るが、Google Cloud 側で参照元（このアプリの
 * ドメイン）と API を絞ってあるので、他所からは使えない。
 */
export const dynamic = 'force-dynamic'

export async function POST() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = process.env.GOOGLE_MAPS_BROWSER_KEY
  if (!key) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  const spend = await spendApiCall('maps_js')
  if (!spend.allowed) {
    return NextResponse.json(
      { error: 'over_budget', used_today: spend.used_today, daily: spend.daily },
      { status: 429 }
    )
  }

  return NextResponse.json({ key, used_today: spend.used_today, daily: spend.daily })
}
