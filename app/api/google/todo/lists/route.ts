import { NextResponse } from 'next/server'

import { isTodoConfigured, listTaskLists, userAccessToken } from '@/lib/google-tasks'
import { getSessionUser } from '@/lib/queries'

/** その人の ToDo リスト一覧（0100）。入れる先を選ぶ画面に出す */
export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isTodoConfigured()) return NextResponse.json({ ok: false, reason: 'サーバーに OAuth クライアントがありません' })

  const auth = await userAccessToken(user.id)
  if ('failed' in auth) return NextResponse.json({ ok: false, reason: auth.failed, reconnect: auth.reconnect ?? false })

  const r = await listTaskLists(auth.token)
  return NextResponse.json(r.ok ? { ok: true, lists: r.lists } : { ok: false, reason: r.reason })
}
