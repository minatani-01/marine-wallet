import { NextResponse } from 'next/server'

import { deleteEvent, isCalendarConfigured, upsertEvent } from '@/lib/google-calendar'
import {
  deleteTodo,
  getConnectionView,
  isTodoConfigured,
  upsertTodo,
  userAccessToken,
} from '@/lib/google-tasks'
import { getSessionUser } from '@/lib/queries'
import { createClient } from '@/lib/supabase/server'
import { GCAL_TAG, GTODO_TAG, eventBody, todoBody, wantsEvent, wantsTodo } from '@/lib/tasks'
import type { Task, TaskCalendar, TaskTodoSettings } from '@/types'

/**
 * タスクを Google カレンダー・Google ToDo と合わせる（0099 / 0100）。
 *
 * 画面がタスクを書いたあとに呼ぶ。1件ずつで、やることは出し先ごとに3つ。
 *   - 印のタグ（と、カレンダーなら期限）があれば、入れる・直す
 *   - 外れていて、向こうに残っていれば消す
 *   - 消すとき（remove）は向こうを消してから行を消す
 *
 * 全部（all）は設定画面の「全部合わせる」から。
 *
 * 失敗しても画面は止めない。何が起きたかは行の gcal_error / gtask_error に
 * 残し、一覧に小さく出す。
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Body = { id?: string; remove?: boolean; all?: boolean; purgeDone?: boolean }

const TASK_COLS =
  'id, user_id, title, note, due_on, due_time, priority, tags, done, done_at, gcal_event_id, gcal_synced_at, gcal_error, gtask_id, gtask_synced_at, gtask_error, created_at, updated_at'

type Client = Awaited<ReturnType<typeof createClient>>

/** 出し先。つないでいなければ null */
type Targets = {
  calendar: { calendarId: string } | null
  todo: { userId: string; listId: string } | null
}

async function resolveTargets(supabase: Client, userId: string): Promise<Targets> {
  const [{ data: calendar }, { data: todo }, connection] = await Promise.all([
    supabase
      .from('task_calendars')
      .select('user_id, calendar_id, enabled, updated_at')
      .eq('user_id', userId)
      .maybeSingle<TaskCalendar>(),
    supabase
      .from('task_todo_settings')
      .select('user_id, tasklist_id, tasklist_title, enabled, updated_at')
      .eq('user_id', userId)
      .maybeSingle<TaskTodoSettings>(),
    isTodoConfigured() ? getConnectionView(userId) : Promise.resolve(null),
  ])
  return {
    calendar:
      calendar?.enabled && calendar.calendar_id && isCalendarConfigured()
        ? { calendarId: calendar.calendar_id }
        : null,
    todo:
      connection && (todo?.enabled ?? true)
        ? { userId, listId: todo?.tasklist_id || '@default' }
        : null,
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as Body
  const supabase = await createClient()
  const targets = await resolveTargets(supabase, user.id)

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
    for (const t of done) {
      for (const e of await removeRemote(targets, t)) errors.push(`${t.title}: ${e}`)
    }
    const { error } = await supabase.from('tasks').delete().eq('user_id', user.id).eq('done', true)
    if (error) return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
    return NextResponse.json({ removed: done.length, errors })
  }

  // --------------------------------------------------------------- 全部
  if (body.all) {
    if (!targets.calendar && !targets.todo) return NextResponse.json({ skipped: 'no_target' })
    const { data: rows } = await supabase
      .from('tasks')
      .select(TASK_COLS)
      .eq('user_id', user.id)
      .returns<Task[]>()
    let synced = 0
    let removed = 0
    const errors: string[] = []
    for (const t of rows ?? []) {
      const r = await syncOne(supabase, targets, t)
      synced += r.synced
      removed += r.removed
      for (const e of r.errors) errors.push(`${t.title}: ${e}`)
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
    const warnings = await removeRemote(targets, task)
    const { error } = await supabase.from('tasks').delete().eq('id', task.id).eq('user_id', user.id)
    if (error) return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
    return NextResponse.json({ removed: 1, warning: warnings.join(' / ') })
  }

  const r = await syncOne(supabase, targets, task)
  return NextResponse.json({ notes: r.notes, errors: r.errors })
}

type SyncResult = { synced: number; removed: number; notes: string[]; errors: string[] }

/**
 * 1件ぶん。カレンダーと ToDo をそれぞれ見る。
 *
 * つないでいない出し先の印が付いていたら、入れずに理由だけ残す。
 * つないだあとに「全部合わせる」で入る。
 */
async function syncOne(supabase: Client, targets: Targets, task: Task): Promise<SyncResult> {
  const out: SyncResult = { synced: 0, removed: 0, notes: [], errors: [] }
  const stamp = new Date().toISOString()
  const patch: Record<string, unknown> = {}

  // ----------------------------------------------------- カレンダー
  if (targets.calendar) {
    if (wantsEvent(task)) {
      const ev = eventBody(task)
      const r = ev
        ? await upsertEvent(targets.calendar.calendarId, task.gcal_event_id, ev)
        : ({ ok: false, reason: '期限がありません' } as const)
      if (r.ok) {
        Object.assign(patch, { gcal_event_id: r.eventId, gcal_synced_at: stamp, gcal_error: '' })
        out.synced++
        out.notes.push('Google カレンダーに入れました')
      } else {
        patch.gcal_error = r.reason
        out.errors.push(`カレンダー: ${r.reason}`)
      }
    } else if (task.gcal_event_id) {
      const r = await deleteEvent(targets.calendar.calendarId, task.gcal_event_id)
      if (r.ok) {
        Object.assign(patch, { gcal_event_id: null, gcal_synced_at: stamp, gcal_error: '' })
        out.removed++
        out.notes.push('Google カレンダーから外しました')
      } else {
        patch.gcal_error = r.reason
        out.errors.push(`カレンダー: ${r.reason}`)
      }
    } else if (task.gcal_error) {
      patch.gcal_error = ''
    }
  } else if (task.tags.includes(GCAL_TAG) && task.gcal_error !== 'Google カレンダーをつないでいません') {
    patch.gcal_error = 'Google カレンダーをつないでいません'
  }

  // ----------------------------------------------------------- ToDo
  if (targets.todo) {
    const need = wantsTodo(task) || Boolean(task.gtask_id)
    const auth = need ? await userAccessToken(targets.todo.userId) : null
    if (auth && 'failed' in auth) {
      patch.gtask_error = auth.failed
      out.errors.push(`ToDo: ${auth.failed}`)
    } else if (auth && wantsTodo(task)) {
      const r = await upsertTodo(auth.token, targets.todo.listId, task.gtask_id, todoBody(task))
      if (r.ok) {
        Object.assign(patch, { gtask_id: r.taskId, gtask_synced_at: stamp, gtask_error: '' })
        out.synced++
        out.notes.push('Google ToDo に入れました')
      } else {
        patch.gtask_error = r.reason
        out.errors.push(`ToDo: ${r.reason}`)
      }
    } else if (auth && task.gtask_id) {
      const r = await deleteTodo(auth.token, targets.todo.listId, task.gtask_id)
      if (r.ok) {
        Object.assign(patch, { gtask_id: null, gtask_synced_at: stamp, gtask_error: '' })
        out.removed++
        out.notes.push('Google ToDo から外しました')
      } else {
        patch.gtask_error = r.reason
        out.errors.push(`ToDo: ${r.reason}`)
      }
    } else if (task.gtask_error) {
      patch.gtask_error = ''
    }
  } else if (task.tags.includes(GTODO_TAG) && task.gtask_error !== 'Google ToDo をつないでいません') {
    patch.gtask_error = 'Google ToDo をつないでいません'
  }

  if (Object.keys(patch).length > 0) {
    await supabase.from('tasks').update(patch).eq('id', task.id)
  }
  return out
}

/** 向こうに残っているぶんを消す。消せなかった理由を返す（行は呼ぶ側で消す） */
async function removeRemote(targets: Targets, task: Task): Promise<string[]> {
  const errors: string[] = []
  if (targets.calendar && task.gcal_event_id) {
    const r = await deleteEvent(targets.calendar.calendarId, task.gcal_event_id)
    if (!r.ok) errors.push(`カレンダー: ${r.reason}`)
  }
  if (targets.todo && task.gtask_id) {
    const auth = await userAccessToken(targets.todo.userId)
    if ('failed' in auth) errors.push(`ToDo: ${auth.failed}`)
    else {
      const r = await deleteTodo(auth.token, targets.todo.listId, task.gtask_id)
      if (!r.ok) errors.push(`ToDo: ${r.reason}`)
    }
  }
  return errors
}
