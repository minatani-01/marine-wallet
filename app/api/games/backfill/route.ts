import { NextResponse } from 'next/server'

import { getProfile, getSessionUser } from '@/lib/queries'
import { backfillGames } from '@/lib/npb/backfill'
import { collectMissingMonths, repairGames } from '@/lib/npb/repair'
import { jstDate } from '@/lib/jst'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * 取りこぼした試合を拾い、すでにある試合を npb.jp の内容に合わせて直す。
 *
 * 毎朝の取り込みは前日の1試合だけを見るので、仕組みを作る前に終わった試合や、
 * 取り込みに失敗した試合は残ったままになる。ここはそれを拾うための、
 * 人が押して動かす口。
 *
 * 3段構えで動く。
 *   1. 取得データの無い月の日程・結果を取る（1回につき3か月まで）
 *   2. すでにある試合の、金額に関わらない項目を直す
 *   3. まだ登録していない試合を取り込む
 *
 * 2 で直すのは 対戦相手 / ホーム・ビジター / 球場 / 得点 だけで、
 * 勝敗もフェーズも触らない。この操作で金額は動かない。
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
    const season = Number(jstDate(new Date()).slice(0, 4))

    // 1. 取得データの無い月を取りに行く。ここで npb.jp へ出る
    const collected = await collectMissingMonths(admin, season)

    // 2. すでにある試合を直す。DB の中だけで完結する
    const repaired = await repairGames(admin, season)

    // 3. まだ登録していない試合を取り込む
    const result = await backfillGames(admin)

    return NextResponse.json({ ok: true, ...result, collected, repaired })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
