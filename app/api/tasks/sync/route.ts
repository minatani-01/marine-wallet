import { NextResponse } from 'next/server'

import { deleteEvent, isCalendarConfigured, upsertEvent } from '@/lib/google-calendar'
import { getSessionUser } from '@/lib/queries'
import { createClient } from '@/lib/supabase/server'
import { GCAL_TAG, eventBody, wantsEvent } from '@/lib/tasks'
import type { Task, TaskCalendar } from '@/types'

/**
 * タスクを Google カレンダーと合わせる（0099）。
 *
 * 画面がタスクを書いたあとに呼ぶ。1件ずつで、やることは3つ。
 *   - タグと期限があれば、予定を入れる・直す
 *   - タグか期限が外れていて、予定が残っていれば消す
 *   - 消すとき（remove）は予定を消してから行を消す
 *
 * 全部（all）は設定画面の「全部合わせる」から。タグの付いた期限ありを
 * 順に入れ、タグの外れた残りを消す。
 *
 * 失敗しても画面は止めない。何が起きたかは行の gcal_error に残し、
 * 一覧に小さく出す。
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Body = { id?: string; remove?: boolean; all?: boolean; purgeDone?: boolean }

const TASK_COLS =
  'id, user_id, title, note, due_on, due_time, priority, tags, done, done_at, gcal_event_id, gcal_synced_at, gcal_error, created_at, updated_at'

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as Body
  const supabase = await createClient()

  const { data: calendar } = await supabase
    .from('task_calendars')
    .select('user_id, calendar_id, enabled, updated_at')
    .eq('user_id', user.id)
    .maybeSingle<TaskCalendar>()
  const ready = Boolean(calendar?.enabled && calendar.calendar_id && isCalendarConfigured())

  // ---------------------------------------------------------- 済みを消す
  if (body.purgeDone) {
    const { data: rows } = await supabase
      .from('tasks')
      .select(TASK_COLS)
      .eq('user_id', user.id)
      .eq('done', true)
      .returns<Task[]>()
    const done = rows ?? []
    const errors: string[] = []
    if (ready && calendar) {
      for (const t of done) {
        if (!t.gcal_event_id) continue
        const r = await deleteEvent(calendar.calendar_id, t.gcal_event_id)
        if (!r.ok) errors.push(`${t.title}: ${r.reason}`)
      }
    }
    const { error } = await supabase.from('tasks').delete().eq('user_id', user.id).eq('done', true)
    if (error) return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
    return NextResponse.json({ removed: done.length, errors })
  }

  // --------------------------------------------------------------- 全部
  if (body.all) {
    if (!ready || !calendar) return NextResponse.json({ skipped: 'no_calendar' })
    const { data: rows } = await supabase
      .from('tasks')
      .select(TASK_COLS)
      .eq('user_id', user.id)
      .returns<Task[]>()
    let synced = 0
    let removed = 0
    const errors: string[] = []
    for (const t of rows ?? []) {
      const r = await syncOne(supabase, calendar, t)
      if (r === 'synced') synced++
      else if (r === 'removed') removed++
      else if (r) errors.push(`${t.title}: ${r}`)
    }
    return NextResponse.json({ synced, removed, errors })
  }

  // ---------------------------------------------------------------- 1件
  if (!body.id) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const { data: task } = await supabase
    .from('tasks')
    .select(TASK_COLS)
    .eq('id', body.id)
    .eq('user_id', user.id)
    .maybeSingle<Task>()
  if (!task) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (body.remove) {
    let warning = ''
    if (task.gcal_event_id && ready && calendar) {
      const r = await deleteEvent(calendar.calendar_id, task.gcal_event_id)
      if (!r.ok) warning = r.reason
    }
    const { error } = await supabase.from('tasks').delete().eq('id', task.id).eq('user_id', user.id)
    if (error) return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
    return NextResponse.json({ removed: 1, warning })
  }

  if (!ready || !calendar) {
    // つないでいない人がタグを付けたとき。入れずに、理由だけ残す
    if (task.tags.includes(GCAL_TAG)) {
      await supabase
        .from('tasks')
        .update({ gcal_error: 'Google カレンダーをつないでいません' })
        .eq('id', task.id)
    }
    return NextResponse.json({ skipped: 'no_calendar' })
  }
  const r = await syncOne(supabase, calendar, task)
  if (r === 'synced' || r === 'removed' || r === null) return NextResponse.json({ result: r ?? 'none' })
  return NextResponse.json({ result: 'error', reason: r })
}

type Client = Awaited<ReturnType<typeof createClient>>

/**
 * 1件ぶん。戻り値は 'synced' | 'removed' | null（何もしない）| 失敗の理由。
 */
async function syncOne(
  supabase: Client,
  calendar: TaskCalendar,
  task: Task
): Promise<'synced' | 'removed' | string | null> {
  const stamp = new Date().toISOString()
  if (wantsEvent(task)) {
    const ev = eventBody(task)
    if (!ev) return null
    const r = await upsertEvent(calendar.calendar_id, task.gcal_event_id, ev)
    if (!r.ok) {
      await supabase.from('tasks').update({ gcal_error: r.reason }).eq('id', task.id)
      return r.reason
    }
    await supabase
      .from('tasks')
      .update({ gcal_event_id: r.eventId, gcal_synced_at: stamp, gcal_error: '' })
      .eq('id', task.id)
    return 'synced'
  }
  if (task.gcal_event_id) {
    const r = await deleteEvent(calendar.calendar_id, task.gcal_event_id)
    if (!r.ok) {
      await supabase.from('tasks').update({ gcal_error: r.reason }).eq('id', task.id)
      return r.reason
    }
    await supabase
      .from('tasks')
      .update({ gcal_event_id: null, gcal_synced_at: stamp, gcal_error: '' })
      .eq('id', task.id)
    return 'removed'
  }
  if (task.gcal_error) {
    await supabase.from('tasks').update({ gcal_error: '' }).eq('id', task.id)
  }
  return null
}
