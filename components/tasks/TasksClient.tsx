'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import { IconCalendar, IconCheck, IconChevronRight, IconPlus } from '@/components/icons'
import TagSheet from '@/components/tasks/TagSheet'
import TaskSheet from '@/components/tasks/TaskSheet'
import { Button, Card, Chip, EmptyState, PillTabs, SectionLabel, inputClass } from '@/components/ui'
import { tapFeedback } from '@/lib/haptics'
import { createClient } from '@/lib/supabase/client'
import {
  DEFAULT_PRIORITY,
  DEFAULT_TAGS,
  DEFAULT_TASK_SORT,
  GCAL_TAG,
  GTODO_TAG,
  TASK_SORTS,
  countSummary,
  dueText,
  groupTasks,
  isOverdue,
  isSpecialTag,
  normalizeTitle,
  orderTags,
  priorityOf,
  rejectTaskReason,
  sortTasks,
  tagTone,
  toTaskSort,
  wantsEvent,
  wantsTodo,
  type TaskSort,
} from '@/lib/tasks'
import type { Task, TaskTag } from '@/types'

/** 並べ方を覚えておく場所。端末ごとで、他の人には移らない */
const SORT_KEY = 'marine-wallet:tasks-sort'

/** 絞り込みの「すべて」。タグ名と混ざらない文字にする */
const ALL = '\u0000all'

/**
 * タスクの一覧（0099）。
 *
 * 上に数、次に入れる欄、その下に一覧。入れる欄を一覧より上に置くのは、
 * 思いついたときに1行で入れられるようにするため。期限も重さもあとで
 * 付ければよい。
 *
 * 一覧は期限順か重要度順で区切って出す。丸の色が重要度。押せば済む。
 * 行を押せば直す札が開く。
 */
export default function TasksClient({
  userId,
  tasks,
  tags,
  calendarReady,
  todoReady,
  today,
}: {
  userId: string
  tasks: Task[]
  tags: TaskTag[]
  /** Google カレンダーにつないであるか。タグの横に印を出す */
  calendarReady: boolean
  /** Google ToDo につないであるか（0100） */
  todoReady: boolean
  /** サーバーが出した日本時間の今日 */
  today: string
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  /** 編集中。null は「追加」で開いたとき。閉じているあいだは undefined */
  const [editing, setEditing] = useState<Task | null | undefined>(undefined)
  const [tagging, setTagging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** カレンダーに入れた・入れられなかったの知らせ。次の操作で消す */
  const [syncNote, setSyncNote] = useState<string | null>(null)

  const order = useMemo(() => tags.map((t) => t.name), [tags])

  /**
   * 最初に開いたときにタグを用意する（0099）。
   *
   * 空のままだと「タグを足す」から始めることになり、何に使うものか
   * 分からない。買物・仕事・金融・その他・Googleカレンダー を入れておく。
   * 要らなければ消せる。
   */
  const seeded = useRef(false)
  useEffect(() => {
    if (tags.length > 0 || seeded.current) return
    seeded.current = true
    void (async () => {
      const { error } = await supabase
        .from('task_tags')
        .upsert(
          DEFAULT_TAGS.map((name, i) => ({ user_id: userId, name, sort_order: i })),
          { onConflict: 'user_id,name', ignoreDuplicates: true }
        )
      if (!error) router.refresh()
    })()
  }, [tags.length, supabase, userId, router])

  /**
   * 押した直後の状態。サーバーに書いて読み直すまでのあいだ、これを先に出す。
   * 新しい一覧が届いたら捨てて、サーバーの値に戻す。
   */
  const [flipped, setFlipped] = useState<Record<string, boolean>>({})
  useEffect(() => setFlipped({}), [tasks])

  const rows = useMemo(
    () => tasks.map((t) => (t.id in flipped ? { ...t, done: flipped[t.id] } : t)),
    [tasks, flipped]
  )

  const [sort, setSort] = useState<TaskSort>(DEFAULT_TASK_SORT)
  useEffect(() => {
    try {
      setSort(toTaskSort(localStorage.getItem(SORT_KEY)))
    } catch {
      // 読めなくても既定で動く
    }
  }, [])
  const pickSort = (next: TaskSort) => {
    setSort(next)
    try {
      localStorage.setItem(SORT_KEY, next)
    } catch {
      // 覚えられなくても並べ替えはできる
    }
  }

  const [filter, setFilter] = useState<string>(ALL)
  // 絞っていたタグが消えたら「すべて」に戻す
  useEffect(() => {
    if (filter !== ALL && !order.includes(filter)) setFilter(ALL)
  }, [filter, order])

  const visible = useMemo(
    () => (filter === ALL ? rows : rows.filter((t) => t.tags.includes(filter))),
    [rows, filter]
  )
  const open = useMemo(() => visible.filter((t) => !t.done), [visible])
  const finished = useMemo(
    () => sortTasks(visible.filter((t) => t.done), 'created'),
    [visible]
  )
  const groups = useMemo(() => groupTasks(sortTasks(open, sort), sort, today), [open, sort, today])
  const summary = useMemo(() => countSummary(rows, today), [rows, today])

  const [showDone, setShowDone] = useState(false)

  // ------------------------------------------------------------ 同期 ----

  /** カレンダーと合わせる。失敗しても一覧は進める。理由だけ出す */
  const sync = async (id: string) => {
    try {
      const res = await fetch('/api/tasks/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const json = (await res.json().catch(() => ({}))) as { notes?: string[]; errors?: string[] }
      const lines = [...(json.notes ?? []), ...(json.errors ?? []).map((e) => `入れられませんでした（${e}）`)]
      if (lines.length) setSyncNote(lines.join(' / '))
    } catch {
      setSyncNote('Google に届きませんでした')
    }
    router.refresh()
  }

  // ------------------------------------------------------- すぐ入れる ----

  const [quick, setQuick] = useState('')
  const [adding, setAdding] = useState(false)

  const quickAdd = async () => {
    const title = normalizeTitle(quick)
    const reason = rejectTaskReason({ title, due_on: null, due_time: null })
    if (reason) {
      setError(reason)
      return
    }
    setError(null)
    setSyncNote(null)
    setAdding(true)
    tapFeedback()
    // 絞っているタグがあれば、そのタグを付けて入れる。買物を見ながら
    // 足したものは買物のはずで、付け直させるのは手間
    const tagsForNew = filter === ALL ? [] : [filter]
    const { data, error } = await supabase
      .from('tasks')
      .insert({ user_id: userId, title, priority: DEFAULT_PRIORITY, tags: tagsForNew })
      .select('id')
      .single<{ id: string }>()
    setAdding(false)
    if (error) {
      setError('入れられませんでした')
      return
    }
    setQuick('')
    if (data && (tagsForNew.includes(GCAL_TAG) || tagsForNew.includes(GTODO_TAG))) await sync(data.id)
    else router.refresh()
  }

  // ---------------------------------------------------------- 済み ----

  const toggleDone = async (task: Task) => {
    const next = !task.done
    setFlipped((prev) => ({ ...prev, [task.id]: next }))
    setSyncNote(null)
    const { error } = await supabase
      .from('tasks')
      .update({ done: next, done_at: next ? new Date().toISOString() : null })
      .eq('id', task.id)
    if (error) {
      setFlipped((prev) => ({ ...prev, [task.id]: task.done }))
      setError('書けませんでした')
      return
    }
    // カレンダーに入れてあるものは、済の印を向こうにも付ける
    if (wantsEvent(task) || task.gcal_event_id || wantsTodo(task) || task.gtask_id) await sync(task.id)
    else router.refresh()
  }

  const purgeDone = async () => {
    if (!window.confirm(`済んだ ${finished.length} 件を消しますか？\nGoogle に入れた予定・ToDo も消えます。`)) return
    const res = await fetch('/api/tasks/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purgeDone: true }),
    })
    if (!res.ok) {
      setError('消せませんでした')
      return
    }
    router.refresh()
  }

  // ---------------------------------------------------------- 描画 ----

  return (
    <div className="space-y-5">
      {/* 上の数。残り・今日・期限切れ。期限切れが 0 でないときだけ赤くする */}
      <Card>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="残り" value={summary.open} />
          <Stat label="今日" value={summary.today} tone={summary.today > 0 ? 'marine' : undefined} />
          <Stat label="期限切れ" value={summary.overdue} tone={summary.overdue > 0 ? 'danger' : undefined} />
        </div>
      </Card>

      {/* 1行で入れる。詳しくは行を押してから */}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void quickAdd()
        }}
      >
        <input
          type="text"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder={filter === ALL ? 'やることを入れる' : `${filter}に入れる`}
          aria-label="やること"
          enterKeyHint="done"
          className={inputClass}
        />
        <Button type="submit" variant="primary" disabled={adding || !quick.trim()} className="shrink-0 px-3.5" aria-label="足す">
          <IconPlus size={18} />
        </Button>
      </form>

      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {syncNote ? <p className="text-xs text-fg-dim">{syncNote}</p> : null}

      {/* 並べ方と絞り込み */}
      <div className="space-y-2.5">
        <PillTabs value={sort} options={[...TASK_SORTS]} onChange={pickSort} />
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
          <Chip selected={filter === ALL} onClick={() => setFilter(ALL)} className="shrink-0 !min-h-[36px] !py-1 text-[12px]">
            すべて
          </Chip>
          {order.map((name) => (
            <Chip
              key={name}
              selected={filter === name}
              onClick={() => setFilter(filter === name ? ALL : name)}
              className="shrink-0 !min-h-[36px] !py-1 text-[12px]"
            >
              {name}
            </Chip>
          ))}
          <button
            type="button"
            onClick={() => setTagging(true)}
            className="min-h-[36px] shrink-0 rounded-xl border border-dashed border-line px-3 text-[12px] text-fg-mute transition-colors hover:border-marine/50 hover:text-fg"
          >
            タグを直す
          </button>
        </div>
      </div>

      {/* 一覧 */}
      {groups.length === 0 ? (
        <EmptyState
          title={filter === ALL ? 'やることはありません' : `${filter}のやることはありません`}
          description="上の欄に入れると、ここに並びます"
        />
      ) : (
        groups.map((group) => (
          <div key={group.id}>
            {group.label ? (
              <SectionLabel>
                <span className={group.id === 'overdue' ? 'text-danger' : undefined}>
                  {group.label}
                </span>
                <span className="ml-1.5 text-fg-mute">{group.tasks.length}</span>
              </SectionLabel>
            ) : null}
            <Card padded={false}>
              <ul>
                {group.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    order={order}
                    today={today}
                    calendarReady={calendarReady}
                    todoReady={todoReady}
                    onToggle={() => void toggleDone(task)}
                    onOpen={() => setEditing(task)}
                  />
                ))}
              </ul>
            </Card>
          </div>
        ))
      )}

      {/* 済んだもの。畳んでおく。消すのは押したときだけ */}
      {finished.length > 0 ? (
        <div>
          <SectionLabel
            action={
              showDone ? (
                <button type="button" onClick={() => void purgeDone()} className="text-[11px] text-fg-mute hover:text-danger">
                  済みを消す
                </button>
              ) : null
            }
          >
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              aria-expanded={showDone}
              className="inline-flex items-center gap-1 hover:text-fg"
            >
              済み <span className="text-fg-mute">{finished.length}</span>
              <IconChevronRight size={12} className={`transition-transform ${showDone ? 'rotate-90' : ''}`} />
            </button>
          </SectionLabel>
          {showDone ? (
            <Card padded={false}>
              <ul>
                {finished.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    order={order}
                    today={today}
                    calendarReady={calendarReady}
                    todoReady={todoReady}
                    onToggle={() => void toggleDone(task)}
                    onOpen={() => setEditing(task)}
                  />
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      ) : null}

      {/* Google との連携（0099 / 0100） */}
      <Link
        href="/tasks/google"
        prefetch={false}
        className="glass flex items-center gap-3 rounded-2xl p-4 transition-colors hover:border-marine/50"
      >
        <IconCalendar size={18} className="shrink-0 text-fg-mute" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px]">Google ToDo・Google カレンダー</p>
          <p className="mt-0.5 text-[11px] text-fg-mute">
            ToDo: {todoReady ? 'つないでいます' : 'まだ'}・カレンダー: {calendarReady ? 'つないでいます' : 'まだ'}。
            「{GTODO_TAG}」「{GCAL_TAG}」タグで出し先を決めます
          </p>
        </div>
        <IconChevronRight size={18} className="shrink-0 text-fg-mute" />
      </Link>

      {/* ホーム画面に置く（0099）。アプリの中にボタンは無いので、やり方だけ書く */}
      <p className="px-1 text-[11px] leading-relaxed text-fg-mute">
        ホーム画面に置くには: Chrome の「アプリをインストール」で入れた Marine Wallet の
        アイコンを長押し →「タスク」をホーム画面へ。
      </p>

      {editing !== undefined ? (
        <TaskSheet
          task={editing}
          userId={userId}
          tagOrder={order}
          today={today}
          calendarReady={calendarReady}
          todoReady={todoReady}
          onSynced={(note) => setSyncNote(note)}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
      {tagging ? (
        <TagSheet userId={userId} tags={tags} tasks={tasks} onClose={() => setTagging(false)} />
      ) : null}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'marine' | 'danger' }) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'marine' ? 'text-marine' : 'text-fg'
  return (
    <div>
      <p className={`tnum text-2xl font-semibold leading-none ${color}`}>{value}</p>
      <p className="mt-1.5 text-[11px] text-fg-mute">{label}</p>
    </div>
  )
}

/**
 * 1行。
 *
 * 左の丸が重要度の色で、押すと済む。残りを押すと直す札が開く。
 * 2行目に期限とタグ。期限切れは赤。カレンダーに入れてあるものは
 * 暦の印、入れられなかったものは赤い印。
 */
function TaskRow({
  task,
  order,
  today,
  calendarReady,
  todoReady,
  onToggle,
  onOpen,
}: {
  task: Task
  order: string[]
  today: string
  calendarReady: boolean
  todoReady: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const p = priorityOf(task.priority)
  const overdue = isOverdue(task, today)
  const shown = orderTags(task.tags, order)
  const onCalendar = Boolean(task.gcal_event_id) && !task.gcal_error
  const calendarTrouble = task.tags.includes(GCAL_TAG) && Boolean(task.gcal_error)
  const onTodo = Boolean(task.gtask_id) && !task.gtask_error
  const todoTrouble = task.tags.includes(GTODO_TAG) && Boolean(task.gtask_error)

  return (
    <li className="flex items-start gap-3 border-b border-line-soft px-3 py-2.5 last:border-0">
      <button
        type="button"
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? '戻す' : '済ませる'}
        onClick={() => {
          tapFeedback()
          onToggle()
        }}
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          task.done ? `${p.ring} ${p.dot} text-ink` : `${p.ring} bg-transparent hover:bg-white/[0.04]`
        }`}
      >
        {task.done ? <IconCheck size={13} /> : null}
      </button>

      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p
          className={`text-[14px] leading-snug break-words ${
            task.done ? 'text-fg-mute line-through' : 'text-fg'
          }`}
        >
          {task.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <span className={`inline-flex items-center gap-1 ${task.done ? 'text-fg-mute' : p.text}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${p.dot}`} />
            {p.label}
          </span>
          {task.due_on ? (
            <span className={overdue ? 'font-medium text-danger' : 'text-fg-dim'}>
              {dueText(task, today)}
            </span>
          ) : null}
          {shown.map((name) => (
            <span
              key={name}
              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-[1px] text-[10px] ${tagTone(name, order)}`}
            >
              {isSpecialTag(name) ? <IconCalendar size={10} /> : null}
              {name}
            </span>
          ))}
          {onTodo && todoReady ? <span className="text-[10px] text-fg-mute">ToDo に入っています</span> : null}
          {todoTrouble ? (
            <span className="text-[10px] text-danger" title={task.gtask_error}>
              ToDo に入っていません
            </span>
          ) : null}
          {onCalendar && calendarReady ? (
            <span className="text-[10px] text-fg-mute">予定に入っています</span>
          ) : null}
          {calendarTrouble ? (
            <span className="text-[10px] text-danger" title={task.gcal_error}>
              予定に入っていません
            </span>
          ) : null}
        </div>
      </button>
    </li>
  )
}
