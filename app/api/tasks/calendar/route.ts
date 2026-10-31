import { NextResponse } from 'next/server'

import { isCalendarConfigured, probeCalendar, serviceAccountEmail } from '@/lib/google-calendar'
import { getSessionUser } from '@/lib/queries'
import { createClient } from '@/lib/supabase/server'
import type { TaskCalendar } from '@/types'

/**
 * Google カレンダーの接続を確かめる（0099）。
 *
 * 設定画面の「つながるか確かめる」から。保存してあるカレンダー ID で
 * 予定を1件読んでみる。読めれば ID と共有は合っている。
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const email = serviceAccountEmail()
  if (!isCalendarConfigured()) {
    return NextResponse.json({ ok: false, email, reason: 'サーバーにサービスアカウントの鍵がありません' })
  }

  const supabase = await createClient()
  const { data: calendar } = await supabase
    .from('task_calendars')
    .select('user_id, calendar_id, enabled, updated_at')
    .eq('user_id', user.id)
    .maybeSingle<TaskCalendar>()
  if (!calendar?.calendar_id) {
    return NextResponse.json({ ok: false, email, reason: 'カレンダー ID を保存してから確かめてください' })
  }

  const r = await probeCalendar(calendar.calendar_id)
  return NextResponse.json(r.ok ? { ok: true, email, summary: r.summary } : { ok: false, email, reason: r.reason })
}
