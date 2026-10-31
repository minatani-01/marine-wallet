'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import { IconCalendar } from '@/components/icons'
import { Button, Field, Segmented, Sheet, inputClass } from '@/components/ui'
import { tapFeedback } from '@/lib/haptics'
import { createClient } from '@/lib/supabase/client'
import {
  GCAL_TAG,
  PRIORITIES,
  normalizeTitle,
  priorityOf,
  rejectTaskReason,
  tagTone,
  toPriority,
  toggleTag,
  wantsEvent,
  type Priority,
} from '@/lib/tasks'
import type { Task } from '@/types'

/**
 * タスクを足す・直す（0099）。
 *
 * 必須は題名だけ。期限は「なし / あり」で切り替え、ありのときだけ日付と
 * 時刻の欄を出す。重要度は3つから選ぶ。色は一覧の丸と同じ。
 *
 * Google カレンダーのタグを付けると、期限ありのものが予定になる。
 * つないでいないときはその旨を出すが、タグを付けること自体は止めない。
 * あとでつないだときに「全部合わせる」で入る。
 */
export default function TaskSheet({
  task,
  userId,
  tagOrder,
  today,
  calendarReady,
  onSynced,
  onClose,
}: {
  /** null なら新しく足す */
  task: Task | null
  userId: string
  /** 使えるタグ。登録順 */
  tagOrder: string[]
  today: string
  calendarReady: boolean
  /** カレンダーと合わせた結果を一覧に知らせる */
  onSynced: (note: string) => void
  onClose: () => void
}) {
  const router = useRouter()

  const [title, setTitle] = useState(task?.title ?? '')
  const [note, setNote] = useState(task?.note ?? '')
  const [hasDue, setHasDue] = useState(Boolean(task?.due_on))
  const [dueOn, setDueOn] = useState(task?.due_on ?? today)
  const [dueTime, setDueTime] = useState(task?.due_time ?? '')
  const [priority, setPriority] = useState<Priority>(toPriority(task?.priority))
  const [tags, setTags] = useState<string[]>(task?.tags ?? [])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const due_on = hasDue ? dueOn : null
  const due_time = hasDue && dueTime ? dueTime : null
  const willSync = wantsEvent({ tags, due_on })

  /** カレンダーと合わせる。1件ぶん。結果は一覧側に出す */
  const sync = async (id: string) => {
    try {
      const res = await fetch('/api/tasks/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const json = (await res.json().catch(() => ({}))) as { result?: string; reason?: string }
      if (json.result === 'synced') onSynced('Google カレンダーに入れました')
      else if (json.result === 'removed') onSynced('Google カレンダーから外しました')
      else if (json.result === 'error') onSynced(`カレンダーに入れられませんでした（${json.reason}）`)
    } catch {
      onSynced('カレンダーに届きませんでした')
    }
  }

  const save = async () => {
    const cleanTitle = normalizeTitle(title)
    const reason = rejectTaskReason({ title: cleanTitle, due_on, due_time })
    if (reason) {
      setError(reason)
      return
    }
    setError(null)
    setSaving(true)

    const supabase = createClient()
    const row = {
      user_id: userId,
      title: cleanTitle,
      note: note.trim(),
      due_on,
      due_time,
      priority,
      tags,
      updated_at: new Date().toISOString(),
    }
    let id = task?.id ?? null
    if (task) {
      const { error } = await supabase.from('tasks').update(row).eq('id', task.id)
      if (error) {
        setSaving(false)
        setError('保存できませんでした')
        return
      }
    } else {
      const { data, error } = await supabase.from('tasks').insert(row).select('id').single<{ id: string }>()
      if (error || !data) {
        setSaving(false)
        setError('保存できませんでした')
        return
      }
      id = data.id
    }

    // 予定にするもの、予定から外すもの（前は入っていた）だけ合わせに行く
    const touchesCalendar = willSync || Boolean(task?.gcal_event_id) || Boolean(task && wantsEvent(task))
    if (id && touchesCalendar) await sync(id)

    setSaving(false)
    router.refresh()
    onClose()
  }

  const remove = async () => {
    if (!task) return
    if (!window.confirm(`「${task.title}」を消しますか？`)) return
    setSaving(true)
    // 予定を消してから行を消す。順番が逆だと予定だけ残る
    const res = await fetch('/api/tasks/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: task.id, remove: true }),
    })
    setSaving(false)
    if (!res.ok) {
      setError('消せませんでした')
      return
    }
    const json = (await res.json().catch(() => ({}))) as { warning?: string }
    if (json.warning) onSynced(`タスクは消しました。予定は残っています（${json.warning}）`)
    router.refresh()
    onClose()
  }

  return (
    <Sheet
      title={task ? 'やることを直す' : 'やることを足す'}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          {task ? (
            <Button variant="danger" onClick={() => void remove()} disabled={saving} className="shrink-0">
              消す
            </Button>
          ) : null}
          <Button variant="primary" full onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : task ? '保存' : '足す'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Field label="やること">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例: 家賃を振り込む"
            autoFocus={!task}
            className={inputClass}
          />
        </Field>

        <Field label="重要度">
          <div className="grid grid-cols-3 gap-2">
            {PRIORITIES.map((p) => (
              <ToneChip
                key={p.id}
                selected={priority === p.id}
                tone={`border-current ${p.text}`}
                onClick={() => setPriority(p.id)}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${p.dot}`} />
                {p.label}
              </ToneChip>
            ))}
          </div>
        </Field>

        <Field label="期限">
          <Segmented
            value={hasDue ? 'on' : 'off'}
            options={[
              { id: 'off', label: 'なし' },
              { id: 'on', label: 'あり' },
            ]}
            onChange={(v) => setHasDue(v === 'on')}
          />
          {hasDue ? (
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
              <input
                type="date"
                value={dueOn}
                onChange={(e) => setDueOn(e.target.value)}
                aria-label="期限の日"
                className={inputClass}
              />
              <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                aria-label="期限の時刻"
                placeholder="時刻"
                className={`${inputClass} w-[7.5rem]`}
              />
            </div>
          ) : null}
          {hasDue ? (
            <p className="mt-1.5 text-[11px] text-fg-mute">時刻は空でもかまいません（終日になります）</p>
          ) : null}
        </Field>

        <Field label="タグ" hint="いくつでも">
          {tagOrder.length === 0 ? (
            <p className="text-[12px] text-fg-mute">タグはまだありません。一覧の「タグを直す」から足せます</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tagOrder.map((name) => (
                <ToneChip
                  key={name}
                  selected={tags.includes(name)}
                  tone={tagTone(name, tagOrder)}
                  onClick={() => setTags((prev) => toggleTag(prev, name))}
                >
                  {name === GCAL_TAG ? <IconCalendar size={12} /> : null}
                  {name}
                </ToneChip>
              ))}
            </div>
          )}
          {tags.includes(GCAL_TAG) ? (
            <p className="mt-2 text-[11px] leading-relaxed text-fg-mute">
              {!hasDue
                ? '期限を付けると Google カレンダーの予定になります。'
                : calendarReady
                  ? `保存すると Google カレンダーに${dueTime ? '1時間の予定' : '終日の予定'}として入ります。`
                  : 'Google カレンダーをまだつないでいません。つないだあとに「全部合わせる」で入ります。'}
            </p>
          ) : null}
        </Field>

        <Field label="メモ" hint="任意">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="店の名前、金額、URL など"
            className={`${inputClass} resize-none`}
          />
        </Field>

        {error ? <p className="text-xs text-danger">{error}</p> : null}
        {task?.gcal_error && task.tags.includes(GCAL_TAG) ? (
          <p className="text-[11px] text-danger">前回のカレンダー連携: {task.gcal_error}</p>
        ) : null}
        {task ? (
          <p className="text-[11px] text-fg-mute">
            いまの重要度: {priorityOf(task.priority).label}
            {task.done ? '・済み' : ''}
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}

/**
 * 色つきの選択札。
 *
 * 共通の Chip は選ぶと水色になる。重要度とタグはそれぞれの色で光らせたい
 * ので、ここだけ自前で出す。選んでいないときは枠だけ。
 */
function ToneChip({
  selected,
  tone,
  onClick,
  children,
}: {
  selected: boolean
  /** 選んだときの枠と文字の色（border-… text-…） */
  tone: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => {
        tapFeedback()
        onClick()
      }}
      className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors ${
        selected ? `bg-white/[0.04] font-medium ${tone}` : 'border-line bg-white/[0.02] text-fg-dim hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}
