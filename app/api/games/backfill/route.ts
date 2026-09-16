import { NextResponse } from 'next/server'

import { getProfile, getSessionUser } from '@/lib/queries'
import { backfillGames } from '@/lib/npb/backfill'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * まだ貯金に入っていない試合を、あとからまとめて取り込む。
 *
 * 毎朝の取り込みは前日の1試合だけを見るので、仕組みを作る前に終わった試合や、
 * 取り込みに失敗した試合は残ったままになる。ここはそれを拾うための、
 * 人が押して動かす口。
 *
 * マスターだけが押せる。試合は全員で共有するデータなので、
 * 誰でも増やせる状態にはしない。
 *
 * npb.jp へ出られるのは本番のサーバーだけなので、取得はここで行う。
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
    const result = await backfillGames(admin)
    return NextResponse.json({ ok: true, ...result })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
