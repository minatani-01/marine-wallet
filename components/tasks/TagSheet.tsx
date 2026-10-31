'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { IconCalendar, IconTrash } from '@/components/icons'
import { Button, Sheet, inputClass } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { GCAL_TAG, normalizeTag, rejectTagReason, tagTone } from '@/lib/tasks'
import type { Task, TaskTag } from '@/types'

/**
 * タグを足す・消す（0099）。
 *
 * タグはその人のもの。買物・仕事・金融・その他は最初から入っているが、
 * 消してもよいし、旅行・家のことなど好きに足せる。
 *
 * 消すと、付いていたタスクからも外れる（タスクそのものは残る）。何件に
 * 効くかを出して確かめる。「Googleカレンダー」も消せるが、消すと予定に
 * 入れる手段が無くなるので、そのことだけ添える。
 */
export default function TagSheet({
  userId,
  tags,
  tasks,
  onClose,
}: {
  userId: string
  tags: TaskTag[]
  tasks: Task[]
  onClose: () => void
}) {
  const router = useRouter()
  const order = tags.map((t) => t.name)

  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const usage = (tag: string) => tasks.filter((t) => t.tags.includes(tag)).length

  const add = async () => {
    const reason = rejectTagReason(name, order)
    if (reason) {
      setError(reason)
      return
    }
    setError(null)
    setBusy(true)
    const supabase = createClient()
    const { error } = await supabase.from('task_tags').insert({
      user_id: userId,
      name: normalizeTag(name),
      sort_order: tags.length,
    })
    setBusy(false)
    if (error) {
      setError('足せませんでした')
      return
    }
    setName('')
    router.refresh()
  }

  const remove = async (tag: TaskTag) => {
    const used = usage(tag.name)
    const extra = tag.name === GCAL_TAG ? '\nこのタグを消すと、予定として入れる手段が無くなります。' : ''
    if (!window.confirm(`「${tag.name}」を消しますか？\n${used}件のやることから外れます（やることは残ります）。${extra}`)) return
    setBusy(true)
    const supabase = createClient()
    // 付いているタスクから外す。1件ずつだが、数十件を越えることはまず無い
    for (const t of tasks) {
      if (!t.tags.includes(tag.name)) continue
      await supabase
        .from('tasks')
        .update({ tags: t.tags.filter((n) => n !== tag.name) })
        .eq('id', t.id)
    }
    const { error } = await supabase.from('task_tags').delete().eq('id', tag.id)
    setBusy(false)
    if (error) {
      setError('消せませんでした')
      return
    }
    router.refresh()
  }

  return (
    <Sheet title="タグ" onClose={onClose}>
      <div className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="新しいタグ（例: 旅行）"
            aria-label="新しいタグ"
            className={inputClass}
          />
          <Button type="submit" variant="primary" disabled={busy || !name.trim()} className="shrink-0">
            足す
          </Button>
        </form>
        {error ? <p className="text-xs text-danger">{error}</p> : null}

        {tags.length === 0 ? (
          <p className="text-[12px] text-fg-mute">タグはまだありません</p>
        ) : (
          <ul className="divide-y divide-line-soft rounded-2xl border border-line">
            {tags.map((tag) => (
              <li key={tag.id} className="flex items-center gap-3 px-3 py-2.5">
                <span
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[12px] ${tagTone(tag.name, order)}`}
                >
                  {tag.name === GCAL_TAG ? <IconCalendar size={12} /> : null}
                  {tag.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-fg-mute">{usage(tag.name)}件で使用</span>
                <button
                  type="button"
                  onClick={() => void remove(tag)}
                  disabled={busy}
                  aria-label={`${tag.name}を消す`}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-mute transition-colors hover:text-danger disabled:opacity-40"
                >
                  <IconTrash size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] leading-relaxed text-fg-mute">
          「{GCAL_TAG}」を付けた期限ありのやることは、Google カレンダーの予定になります。
        </p>
      </div>
    </Sheet>
  )
}
