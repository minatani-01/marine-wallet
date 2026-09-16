import { NextResponse } from 'next/server'

import { getProfile, getSessionUser } from '@/lib/queries'
import { registerMilestones } from '@/lib/npb/milestone-register'
import { snapshotSourcePages } from '@/lib/npb/pages'
import { jstDate } from '@/lib/jst'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * 記録達成を今すぐ取り込む。
 *
 * ページを取り直してから読み取り、達成していれば積立まで作る。
 * 毎朝の取り込みでも同じことをしている。こちらは、仕込んだ直後や
 * npb.jp の作りが変わったときに、翌朝を待たずに動かすための口。
 *
 * 何度押しても積立は積み上がらない。台帳（npb_milestones）の一意キーで
 * 同じ記録を二度入れないようにしてある。
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

    // 先にページを取り直す。古いページのまま読み取ると、
    // 昨日の達成を拾えないまま「変化なし」になる
    const pages = await snapshotSourcePages(admin, season)
    const result = await registerMilestones(admin, season)

    return NextResponse.json({ ok: true, ...result, pages })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
