import { NextResponse } from 'next/server'

import { getProfile, getSessionUser } from '@/lib/queries'
import { snapshotSourcePages } from '@/lib/npb/pages'
import { jstDate } from '@/lib/jst'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * 記録達成の判定に使うページを、今すぐ取りに行く。
 *
 * 毎朝の取り込みでも同じことをしている。こちらは、仕込んだ直後や
 * npb.jp の作りが変わったときに、翌朝を待たずに取り直すための口。
 *
 * npb.jp へ出られるのは本番のサーバーだけなので、取得はここで行う。
 * マスターだけが押せる。
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const profile = await getProfile(user.id)
  if (!profile?.is_master) {
    return NextResponse.json({ error: 'マスターのみ実行できます' }, { status: 403 })
  }

  // 設定漏れをここで拾う。try の外で例外にすると本文の無い 500 になる
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return NextResponse.json({ error: message }, { status: 503 })
  }

  try {
    const season = Number(jstDate(new Date()).slice(0, 4))
    const result = await snapshotSourcePages(admin, season)
    return NextResponse.json({ ok: true, ...result })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
