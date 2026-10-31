/**
 * タスク・ToDo（0099）。
 *
 * 仕事のやること、買い物、払うもの。期限と重さを付けて並べ替えられる形で
 * 持つ。期限は無くてもよい。「いつか」のものを無理に日付で縛ると、
 * 期限切れの山になって見なくなる。
 *
 * ここは純関数にしてある。DB も時計も触らないので、テストで確かめられる。
 * 日付は日本時間の 'YYYY-MM-DD'、時刻は 'HH:MM' で受け渡す。
 */

import type { Task } from '@/types'

// ------------------------------------------------------------- 重要度 ----

export type Priority = 1 | 2 | 3

/**
 * 重要度。色で見分ける。
 *
 * 高は赤、中は琥珀、低は青緑。文字を読まなくても、丸の色で分かるようにする。
 * 既定は中。全部を高にする人はいないし、全部を低にする人もいない。
 */
export const PRIORITIES = [
  { id: 1, label: '高', dot: 'bg-danger', ring: 'border-danger', text: 'text-danger' },
  { id: 2, label: '中', dot: 'bg-warn', ring: 'border-warn', text: 'text-warn' },
  { id: 3, label: '低', dot: 'bg-teal', ring: 'border-teal', text: 'text-teal' },
] as const satisfies readonly {
  id: Priority
  label: string
  dot: string
  ring: string
  text: string
}[]

export const DEFAULT_PRIORITY: Priority = 2

/** 知らない値なら中に戻す。DB から来た数をそのまま信じない */
export function toPriority(value: unknown): Priority {
  return value === 1 || value === 3 ? value : 2
}

export function priorityOf(p: Priority) {
  return PRIORITIES.find((x) => x.id === p) ?? PRIORITIES[1]
}

// --------------------------------------------------------------- タグ ----

/**
 * Google カレンダーに入れる印のタグ。
 *
 * 設定で ON/OFF を分けるのではなく、タグで決める。買い物は入れたくないが
 * 仕事の締め切りは入れたい、というのを1件ずつ選べる。
 */
export const GCAL_TAG = 'Googleカレンダー'

/**
 * Google ToDo に入れる印のタグ（0100）。
 *
 * カレンダーと違って期限が無くても入れられる。買い物リストのように
 * 「いつでもよいが忘れたくない」ものは、こちらのほうが合う。
 */
export const GTODO_TAG = 'GoogleToDo'

/** 最初に用意しておくタグ。消しても足してもよい */
export const DEFAULT_TAGS = ['買物', '仕事', '金融', 'その他', GCAL_TAG, GTODO_TAG] as const

/** 外に出す印のタグ。色を固定し、他のタグの色を消費させない */
const SPECIAL_TAGS: Record<string, string> = {
  [GCAL_TAG]: 'border-marine/60 text-marine',
  [GTODO_TAG]: 'border-blue-400/60 text-blue-300',
}

/** タグ名の長さの上限。札に収まる長さ */
export const TAG_MAX = 20

/**
 * タグの色。重要度の色（赤・琥珀・青緑）と被らないものを順に使う。
 *
 * Google カレンダーのタグだけは水色（marine）で固定する。これは分類では
 * なく「外に出す」印なので、他と区別がつくほうがよい。
 */
const TAG_TONES = [
  'border-violet-400/50 text-violet-300',
  'border-sky-400/50 text-sky-300',
  'border-pink-400/50 text-pink-300',
  'border-lime-400/50 text-lime-300',
  'border-orange-400/50 text-orange-300',
  'border-fuchsia-400/50 text-fuchsia-300',
]

export function tagTone(name: string, order: string[]): string {
  if (SPECIAL_TAGS[name]) return SPECIAL_TAGS[name]
  const at = order.indexOf(name)
  if (at < 0) return 'border-line text-fg-mute'
  // 外に出す印のぶんは色を消費させない。並びの前にあっても後ろにあっても同じ色になる
  const index = order.slice(0, at).filter((n) => !SPECIAL_TAGS[n]).length
  return TAG_TONES[index % TAG_TONES.length]
}

/** 外に出す印のタグか。タグの札に暦のアイコンを添えるかどうかに使う */
export function isSpecialTag(name: string): boolean {
  return Boolean(SPECIAL_TAGS[name])
}

export function toggleTag(tags: string[], name: string): string[] {
  return tags.includes(name) ? tags.filter((t) => t !== name) : [...tags, name]
}

/** 消えたタグは画面に出さない。並びは登録順にそろえる */
export function orderTags(tags: string[], order: string[]): string[] {
  return order.filter((name) => tags.includes(name))
}

export function normalizeTag(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

export function rejectTagReason(raw: string, existing: string[]): string | null {
  const name = normalizeTag(raw)
  if (!name) return 'タグの名前を入れてください'
  if (name.length > TAG_MAX) return `タグは${TAG_MAX}文字までです`
  if (existing.includes(name)) return 'そのタグはもうあります'
  return null
}

// ------------------------------------------------------------- 日付 ----

const YMD = /^\d{4}-\d{2}-\d{2}$/
const HM = /^([01]\d|2[0-3]):[0-5]\d$/

/** 'YYYY-MM-DD' を日に直す。UTC 正午にして、ずれないようにする */
function toDate(ymd: string): Date {
  return new Date(`${ymd}T12:00:00Z`)
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function addDays(ymd: string, n: number): string {
  const d = toDate(ymd)
  d.setUTCDate(d.getUTCDate() + n)
  return toYmd(d)
}

/** today から due まで何日あるか。過ぎていれば負 */
export function daysUntil(today: string, due: string): number {
  return Math.round((toDate(due).getTime() - toDate(today).getTime()) / 86_400_000)
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** 'M/D（曜）'。年が違うときだけ年を付ける */
export function shortDate(ymd: string, today: string): string {
  const d = toDate(ymd)
  const body = `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEKDAYS[d.getUTCDay()]}）`
  return ymd.slice(0, 4) === today.slice(0, 4) ? body : `${ymd.slice(0, 4)}/${body}`
}

/**
 * 期限の見せ方。
 *
 * 近いものは「今日」「明日」と言葉で、遠いものは日付で。過ぎたものは
 * 「3日前」と言い切る。見た瞬間に、急ぐかどうかが分かればよい。
 */
export function dueText(task: Pick<Task, 'due_on' | 'due_time'>, today: string): string {
  if (!task.due_on) return '期限なし'
  const n = daysUntil(today, task.due_on)
  let day: string
  if (n === 0) day = '今日'
  else if (n === 1) day = '明日'
  else if (n === -1) day = '昨日'
  else if (n < 0) day = `${-n}日前`
  else if (n <= 6) day = `${shortDate(task.due_on, today)}`
  else day = shortDate(task.due_on, today)
  return task.due_time ? `${day} ${task.due_time}` : day
}

export function isOverdue(task: Pick<Task, 'due_on' | 'done'>, today: string): boolean {
  return !task.done && task.due_on !== null && task.due_on < today
}

// ---------------------------------------------------------- 並べ替え ----

export type TaskSort = 'due' | 'priority' | 'created'

export const TASK_SORTS = [
  { id: 'due', label: '期限' },
  { id: 'priority', label: '重要度' },
  { id: 'created', label: '追加順' },
] as const satisfies readonly { id: TaskSort; label: string }[]

export const DEFAULT_TASK_SORT: TaskSort = 'due'

export function toTaskSort(value: string | null | undefined): TaskSort {
  return value === 'priority' || value === 'created' ? value : 'due'
}

/** 期限で比べる。無いものは後ろ。同じ日なら時刻のあるほうが先 */
function byDue(a: Task, b: Task): number {
  if (a.due_on === b.due_on) {
    if (a.due_time === b.due_time) return 0
    if (a.due_time === null) return 1
    if (b.due_time === null) return -1
    return a.due_time < b.due_time ? -1 : 1
  }
  if (a.due_on === null) return 1
  if (b.due_on === null) return -1
  return a.due_on < b.due_on ? -1 : 1
}

function byPriority(a: Task, b: Task): number {
  return a.priority - b.priority
}

function byCreated(a: Task, b: Task): number {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
}

/**
 * 並べる。
 *
 * 期限順でも、同じ日の中は重要度で並べる。重要度順でも、同じ重さの中は
 * 期限で並べる。どちらで見ても、上から順にやればよい形にする。
 */
export function sortTasks(tasks: Task[], sort: TaskSort): Task[] {
  const copy = [...tasks]
  if (sort === 'priority') {
    return copy.sort((a, b) => byPriority(a, b) || byDue(a, b) || byCreated(a, b))
  }
  if (sort === 'created') {
    return copy.sort((a, b) => -byCreated(a, b))
  }
  return copy.sort((a, b) => byDue(a, b) || byPriority(a, b) || byCreated(a, b))
}

// -------------------------------------------------------------- 区切り ----

export type DueGroup = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none'

export const DUE_GROUP_LABELS: Record<DueGroup, string> = {
  overdue: '期限切れ',
  today: '今日',
  tomorrow: '明日',
  week: '今週',
  later: 'あとで',
  none: '期限なし',
}

export function dueGroup(task: Pick<Task, 'due_on'>, today: string): DueGroup {
  if (!task.due_on) return 'none'
  const n = daysUntil(today, task.due_on)
  if (n < 0) return 'overdue'
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n <= 6) return 'week'
  return 'later'
}

export type TaskGroup = { id: string; label: string; tasks: Task[] }

/**
 * 並べたあとに、見出しで区切る。
 *
 * 期限順なら「期限切れ・今日・明日・今週・あとで・期限なし」、重要度順なら
 * 「高・中・低」。追加順は区切らない。空の区切りは出さない。
 */
export function groupTasks(sorted: Task[], sort: TaskSort, today: string): TaskGroup[] {
  if (sort === 'created') return sorted.length ? [{ id: 'all', label: '', tasks: sorted }] : []

  const buckets = new Map<string, TaskGroup>()
  const order: string[] =
    sort === 'priority'
      ? PRIORITIES.map((p) => String(p.id))
      : ['overdue', 'today', 'tomorrow', 'week', 'later', 'none']
  for (const id of order) {
    const label =
      sort === 'priority'
        ? `重要度 ${priorityOf(Number(id) as Priority).label}`
        : DUE_GROUP_LABELS[id as DueGroup]
    buckets.set(id, { id, label, tasks: [] })
  }
  for (const task of sorted) {
    const id = sort === 'priority' ? String(task.priority) : dueGroup(task, today)
    buckets.get(id)?.tasks.push(task)
  }
  return [...buckets.values()].filter((g) => g.tasks.length > 0)
}

/** 上に出す数。残り・今日・期限切れ */
export function countSummary(tasks: Task[], today: string): { open: number; today: number; overdue: number } {
  const open = tasks.filter((t) => !t.done)
  return {
    open: open.length,
    today: open.filter((t) => t.due_on === today).length,
    overdue: open.filter((t) => isOverdue(t, today)).length,
  }
}

// ------------------------------------------------------------ 入力の検査 ----

export const TITLE_MAX = 200

export function normalizeTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

export function rejectTaskReason(input: {
  title: string
  due_on: string | null
  due_time: string | null
}): string | null {
  const title = normalizeTitle(input.title)
  if (!title) return 'やることを入れてください'
  if (title.length > TITLE_MAX) return `${TITLE_MAX}文字までにしてください`
  if (input.due_on !== null && !YMD.test(input.due_on)) return '期限の日付が読めません'
  if (input.due_time !== null && !HM.test(input.due_time)) return '時刻は 09:00 のように入れてください'
  if (input.due_on === null && input.due_time !== null) return '時刻だけでは期限になりません'
  return null
}

// ------------------------------------------------- Google カレンダー ----

/** 予定として外に出すか。タグが付いていて、期限がある */
export function wantsEvent(task: Pick<Task, 'tags' | 'due_on'>): boolean {
  return task.tags.includes(GCAL_TAG) && task.due_on !== null
}

/** カレンダー ID の形。メールアドレスの形をしている */
export function rejectCalendarIdReason(raw: string): string | null {
  const id = raw.trim()
  if (!id) return 'カレンダー ID を入れてください'
  if (/\s/.test(id) || !id.includes('@')) return 'カレンダー ID は xxx@group.calendar.google.com の形です'
  return null
}

/** 予定の長さ（分）。時刻ありのとき */
export const EVENT_MINUTES = 60

export type EventBody = {
  summary: string
  description: string
  start: { date: string } | { dateTime: string; timeZone: string }
  end: { date: string } | { dateTime: string; timeZone: string }
  extendedProperties: { private: Record<string, string> }
}

/** 'HH:MM' に分を足す。日をまたいだら繰り上がりの日数も返す */
export function addMinutes(hm: string, minutes: number): { time: string; carry: number } {
  const [h, m] = hm.split(':').map(Number)
  const total = h * 60 + m + minutes
  const carry = Math.floor(total / 1440)
  const rest = ((total % 1440) + 1440) % 1440
  const hh = String(Math.floor(rest / 60)).padStart(2, '0')
  const mm = String(rest % 60).padStart(2, '0')
  return { time: `${hh}:${mm}`, carry }
}

/**
 * Google カレンダーに入れる中身。
 *
 * 時刻があれば1時間の予定、無ければ終日の予定にする。終日の end は
 * 翌日を指す（Google の決まり。end は含まない）。済んだものは消さずに
 * 先頭に「済」を付ける。カレンダーに残っていたほうが、あとで見返せる。
 */
export function eventBody(
  task: Pick<Task, 'id' | 'user_id' | 'title' | 'note' | 'due_on' | 'due_time' | 'done' | 'priority'>,
  timeZone = 'Asia/Tokyo'
): EventBody | null {
  if (!task.due_on) return null
  const summary = `${task.done ? '済 ' : ''}${task.title}`
  const lines = [task.note.trim(), `重要度: ${priorityOf(task.priority).label}`, 'Marine Wallet のタスク']
  const description = lines.filter(Boolean).join('\n')
  const extendedProperties = { private: { marineTaskId: task.id, marineUserId: task.user_id } }

  if (task.due_time) {
    const end = addMinutes(task.due_time, EVENT_MINUTES)
    return {
      summary,
      description,
      start: { dateTime: `${task.due_on}T${task.due_time}:00`, timeZone },
      end: { dateTime: `${addDays(task.due_on, end.carry)}T${end.time}:00`, timeZone },
      extendedProperties,
    }
  }
  return {
    summary,
    description,
    start: { date: task.due_on },
    end: { date: addDays(task.due_on, 1) },
    extendedProperties,
  }
}

// ------------------------------------------------------ Google ToDo ----

/** ToDo として外に出すか。タグが付いていればよい。期限は無くてもよい */
export function wantsTodo(task: Pick<Task, 'tags'>): boolean {
  return task.tags.includes(GTODO_TAG)
}

export type TodoBody = {
  title: string
  notes: string
  /** RFC3339。Google ToDo は日付しか見ない（時刻は捨てられる） */
  due: string | null
  status: 'needsAction' | 'completed'
  /** 戻すときは completed を消す必要がある。null で送ると消える */
  completed: null | undefined
}

/**
 * Google ToDo に入れる中身。
 *
 * 期限は日付だけ。時刻を付けて送っても向こうで捨てられるので、メモに
 * 書いておく。済ませると completed、戻すと needsAction + completed を消す。
 * 重要度は項目が無いので、メモの先頭に入れる。
 */
export function todoBody(
  task: Pick<Task, 'title' | 'note' | 'due_on' | 'due_time' | 'done' | 'priority'>
): TodoBody {
  const lines = [
    task.note.trim(),
    task.due_time ? `時刻: ${task.due_time}` : '',
    `重要度: ${priorityOf(task.priority).label}`,
    'Marine Wallet のタスク',
  ]
  return {
    title: task.title,
    notes: lines.filter(Boolean).join('\n'),
    due: task.due_on ? `${task.due_on}T00:00:00.000Z` : null,
    status: task.done ? 'completed' : 'needsAction',
    completed: task.done ? undefined : null,
  }
}
