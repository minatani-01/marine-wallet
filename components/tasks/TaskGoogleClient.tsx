'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { IconCheck, IconCopy } from '@/components/icons'
import { Button, Card, Field, SectionLabel, Toggle, inputClass } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { GCAL_TAG, GTODO_TAG, rejectCalendarIdReason } from '@/lib/tasks'
import type { GoogleConnectionView, TaskCalendar, TaskTodoSettings } from '@/types'

/**
 * Google との接続（0099 / 0100）。
 *
 * 出し先は2つ。ToDo は本人の Google でつなぐ（ボタン1つ）。カレンダーは
 * サービスアカウントにカレンダーを共有して ID を貼る。手順はそのまま画面に書く。
 */
export default function TaskGoogleClient({
  userId,
  calendar,
  serviceEmail,
  calendarConfigured,
  todo,
  connection,
  todoConfigured,
}: {
  userId: string
  calendar: TaskCalendar | null
  /** カレンダーを共有してもらう相手。サーバーに鍵が無ければ null */
  serviceEmail: string | null
  calendarConfigured: boolean
  todo: TaskTodoSettings | null
  /** Google ToDo とのつながり。無ければ null */
  connection: GoogleConnectionView | null
  todoConfigured: boolean
}) {
  const router = useRouter()
  const params = useSearchParams()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  // つないで戻ってきたとき・断られたときの知らせ
  useEffect(() => {
    const connected = params.get('connected')
    const err = params.get('error')
    if (connected) setNote('Google ToDo とつながりました')
    else if (err === 'cancelled') setError('つなぐのを取りやめました')
    else if (err === 'state') setError('やり直してください（確認用の値が合いませんでした）')
    else if (err === 'not_configured') setError('サーバーに OAuth クライアントが設定されていません')
    else if (err) setError(`つなげませんでした（${err}）`)
  }, [params])

  // ------------------------------------------------------------ ToDo ----

  const [todoEnabled, setTodoEnabled] = useState(todo?.enabled ?? true)
  const [lists, setLists] = useState<{ id: string; title: string }[] | null>(null)
  const [listId, setListId] = useState(todo?.tasklist_id ?? '@default')
  const [listTitle, setListTitle] = useState(todo?.tasklist_title ?? '')

  const loadLists = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/google/todo/lists', { cache: 'no-store' })
      const json = (await res.json()) as { ok: boolean; lists?: { id: string; title: string }[]; reason?: string }
      if (json.ok) setLists(json.lists ?? [])
      else setError(json.reason ?? 'リストを読めませんでした')
    } catch {
      setError('リストを読めませんでした')
    }
    setBusy(false)
  }

  const saveTodo = async () => {
    setBusy(true)
    setError(null)
    setNote(null)
    const supabase = createClient()
    const { error } = await supabase.from('task_todo_settings').upsert(
      {
        user_id: userId,
        tasklist_id: listId || '@default',
        tasklist_title: listTitle,
        enabled: todoEnabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    setBusy(false)
    if (error) {
      setError('保存できませんでした')
      return
    }
    setNote('保存しました')
    router.refresh()
  }

  const disconnectTodo = async () => {
    if (!window.confirm('Google ToDo とのつながりを切りますか？\n入れてある ToDo はそのまま残ります。')) return
    setBusy(true)
    await fetch('/api/google/todo/disconnect', { method: 'POST' })
    setBusy(false)
    router.refresh()
  }

  // -------------------------------------------------------- カレンダー ----

  const [calendarId, setCalendarId] = useState(calendar?.calendar_id ?? '')
  const [calEnabled, setCalEnabled] = useState(calendar?.enabled ?? true)
  const [copied, setCopied] = useState(false)

  const saveCalendar = async () => {
    const reason = rejectCalendarIdReason(calendarId)
    if (reason) {
      setError(reason)
      return
    }
    setError(null)
    setNote(null)
    setBusy(true)
    const supabase = createClient()
    const { error } = await supabase.from('task_calendars').upsert(
      {
        user_id: userId,
        calendar_id: calendarId.trim(),
        enabled: calEnabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    setBusy(false)
    if (error) {
      setError('保存できませんでした')
      return
    }
    setNote('保存しました')
    router.refresh()
  }

  const probeCalendar = async () => {
    setNote(null)
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/tasks/calendar', { cache: 'no-store' })
      const json = (await res.json()) as { ok: boolean; reason?: string; summary?: string }
      if (json.ok) setNote(`カレンダーにつながりました${json.summary ? `（${json.summary}）` : ''}`)
      else setError(json.reason ?? 'つながりませんでした')
    } catch {
      setError('確かめられませんでした')
    }
    setBusy(false)
  }

  const copyEmail = async () => {
    if (!serviceEmail) return
    try {
      await navigator.clipboard.writeText(serviceEmail)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // コピーできなければ、長押しで選んでもらう
    }
  }

  // ------------------------------------------------------------ 全部 ----

  const syncAll = async () => {
    setNote(null)
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/tasks/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      const json = (await res.json()) as { synced?: number; removed?: number; errors?: string[]; skipped?: string }
      if (json.skipped) setError('先にどちらかをつないでください')
      else {
        const errs = json.errors ?? []
        setNote(
          `入れた ${json.synced ?? 0} 件・外した ${json.removed ?? 0} 件` +
            (errs.length ? `・入れられなかった ${errs.length} 件（${errs[0]}）` : '')
        )
      }
    } catch {
      setError('合わせられませんでした')
    }
    setBusy(false)
    router.refresh()
  }

  const todoLinked = Boolean(connection)
  const anyLinked = todoLinked || Boolean(calendar?.enabled)

  return (
    <div className="space-y-5">
      <Card>
        <p className="text-[13px] leading-relaxed">
          タグで出し先を決めます。「{GTODO_TAG}」は Google ToDo に（期限が無くても入る）、
          「{GCAL_TAG}」は Google カレンダーの予定に（期限ありのものだけ）。両方付けてもかまいません。
        </p>
      </Card>

      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {note ? <p className="text-xs text-fg-dim">{note}</p> : null}

      {/* ------------------------------------------------------- ToDo */}
      <div>
        <SectionLabel>Google ToDo</SectionLabel>
        <Card>
          {!todoConfigured ? (
            <>
              <p className="text-[13px] text-warn">サーバーに OAuth クライアントがまだありません。</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-fg-mute">
                Vercel の環境変数に GOOGLE_OAUTH_CLIENT_ID と GOOGLE_OAUTH_CLIENT_SECRET を入れ、
                Google Cloud の OAuth クライアントにリダイレクト URI を足すと使えます（docs/tasks.md）。
              </p>
            </>
          ) : !todoLinked ? (
            <div className="space-y-3">
              <p className="text-[12px] leading-relaxed text-fg-mute">
                自分の Google アカウントでつなぎます。Google の画面で「ToDo リストの作成、編集、整理、削除」に
                チェックを入れて許可してください。
              </p>
              <a
                href="/api/google/todo/connect"
                className="inline-flex min-h-[46px] w-full items-center justify-center rounded-xl bg-marine px-4 text-sm font-semibold text-ink shadow-[0_0_40px_-18px_rgba(34,211,238,0.9)] transition-colors hover:bg-teal"
              >
                Google でつなぐ
              </a>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-[13px]">
                  つないでいます{connection?.email ? `（${connection.email}）` : ''}
                </p>
                {connection?.error ? (
                  <p className="mt-1 text-[11px] text-danger">
                    つなぎ直しが必要です: {connection.error}
                  </p>
                ) : null}
              </div>

              <Field label="入れるリスト" hint={listTitle || (listId === '@default' ? '既定のリスト' : listId)}>
                {lists === null ? (
                  <Button onClick={() => void loadLists()} disabled={busy} full>
                    リストを選ぶ
                  </Button>
                ) : lists.length === 0 ? (
                  <p className="text-[12px] text-fg-mute">リストがありません。既定のリストに入れます</p>
                ) : (
                  <div className="space-y-1.5">
                    {lists.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        aria-pressed={listId === l.id}
                        onClick={() => {
                          setListId(l.id)
                          setListTitle(l.title)
                        }}
                        className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-[13px] transition-colors ${
                          listId === l.id ? 'border-marine/70 bg-marine/10 text-marine' : 'border-line text-fg-dim hover:text-fg'
                        }`}
                      >
                        <span className="truncate">{l.title}</span>
                        {listId === l.id ? <IconCheck size={14} /> : null}
                      </button>
                    ))}
                  </div>
                )}
              </Field>

              <Toggle
                checked={todoEnabled}
                onChange={setTodoEnabled}
                label="ToDo として入れる"
                hint="OFF にすると、タグが付いていても入れません。入れてあるものはそのまま残ります"
              />

              <div className="flex gap-2">
                <Button variant="primary" full onClick={() => void saveTodo()} disabled={busy}>
                  保存
                </Button>
                {connection?.error ? (
                  <a
                    href="/api/google/todo/connect"
                    className="inline-flex min-h-[46px] shrink-0 items-center justify-center rounded-xl border border-line px-4 text-sm text-fg hover:border-marine/60 hover:text-marine"
                  >
                    つなぎ直す
                  </a>
                ) : (
                  <Button variant="danger" onClick={() => void disconnectTodo()} disabled={busy} className="shrink-0">
                    切る
                  </Button>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* --------------------------------------------------- カレンダー */}
      <div>
        <SectionLabel>Google カレンダー</SectionLabel>
        <Card>
          {!calendarConfigured ? (
            <>
              <p className="text-[13px] text-warn">サーバーにサービスアカウントの鍵がまだありません。</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-fg-mute">
                Vercel の環境変数に GOOGLE_SA_CLIENT_EMAIL と GOOGLE_SA_PRIVATE_KEY を入れると使えます
                （docs/tasks.md）。ここで ID を保存しておくこと自体はできます。
              </p>
              <div className="my-4 border-t border-line-soft" />
            </>
          ) : null}
          <ol className="list-decimal space-y-3 pl-5 text-[13px] leading-relaxed">
            <li>Google カレンダー（PC のブラウザ）で、予定を入れたいカレンダーの「設定と共有」を開く</li>
            <li>
              「特定のユーザーまたはグループと共有する」に、次のアドレスを
              <span className="font-medium text-fg">「予定の変更」</span>の権限で足す
              {serviceEmail ? (
                <button
                  type="button"
                  onClick={() => void copyEmail()}
                  className="mt-1.5 flex w-full items-center gap-2 rounded-xl border border-line bg-ink-2/80 px-3 py-2 text-left text-[12px] text-marine"
                >
                  <span className="min-w-0 flex-1 break-all">{serviceEmail}</span>
                  {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                </button>
              ) : (
                <p className="mt-1 text-[11px] text-fg-mute">（鍵が入るとここにアドレスが出ます）</p>
              )}
            </li>
            <li>
              同じ設定画面の下にある「カレンダーの統合」から
              <span className="font-medium text-fg">カレンダー ID</span>をコピーして、下に貼る
            </li>
          </ol>
          <div className="mt-4 space-y-4">
            <Field label="カレンダー ID">
              <input
                type="text"
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
                placeholder="xxxx@group.calendar.google.com"
                inputMode="email"
                autoCapitalize="none"
                className={inputClass}
              />
            </Field>
            <Toggle
              checked={calEnabled}
              onChange={setCalEnabled}
              label="予定として入れる"
              hint="OFF にすると、タグが付いていても入れません。入れてある予定はそのまま残ります"
            />
            <div className="flex gap-2">
              <Button variant="primary" full onClick={() => void saveCalendar()} disabled={busy}>
                保存
              </Button>
              <Button onClick={() => void probeCalendar()} disabled={busy || !calendar} className="shrink-0">
                つながるか確かめる
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* --------------------------------------------------------- 全部 */}
      <div>
        <SectionLabel>まとめて合わせる</SectionLabel>
        <Card>
          <p className="text-[12px] leading-relaxed text-fg-mute">
            つなぐ前に付けたタグのぶんや、入れられなかったものをまとめて入れ直します。
            タグが外れたものは向こうから消します。
          </p>
          <Button full onClick={() => void syncAll()} disabled={busy || !anyLinked} className="mt-3">
            全部合わせる
          </Button>
        </Card>
      </div>
    </div>
  )
}
