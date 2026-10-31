'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { IconCheck, IconCopy } from '@/components/icons'
import { Button, Card, Field, SectionLabel, Toggle, inputClass } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { GCAL_TAG, rejectCalendarIdReason } from '@/lib/tasks'
import type { TaskCalendar } from '@/types'

/**
 * Google カレンダーとの接続（0099）。
 *
 * やることは2つ。自分のカレンダーをサービスアカウントに共有し、
 * そのカレンダー ID をここに入れる。手順をそのまま画面に書く。
 * 一度やれば、以後は触らない。
 */
export default function TaskCalendarClient({
  userId,
  calendar,
  serviceEmail,
  configured,
}: {
  userId: string
  calendar: TaskCalendar | null
  /** 共有してもらう相手。サーバーに鍵が無ければ null */
  serviceEmail: string | null
  /** サーバーに鍵が入っているか */
  configured: boolean
}) {
  const router = useRouter()

  const [calendarId, setCalendarId] = useState(calendar?.calendar_id ?? '')
  const [enabled, setEnabled] = useState(calendar?.enabled ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const save = async () => {
    const reason = rejectCalendarIdReason(calendarId)
    if (reason) {
      setError(reason)
      return
    }
    setError(null)
    setNote(null)
    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase.from('task_calendars').upsert(
      {
        user_id: userId,
        calendar_id: calendarId.trim(),
        enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    setSaving(false)
    if (error) {
      setError('保存できませんでした')
      return
    }
    setNote('保存しました')
    router.refresh()
  }

  const probe = async () => {
    setNote(null)
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/tasks/calendar', { cache: 'no-store' })
      const json = (await res.json()) as { ok: boolean; reason?: string; summary?: string }
      if (json.ok) setNote(`つながりました${json.summary ? `（${json.summary}）` : ''}`)
      else setError(json.reason ?? 'つながりませんでした')
    } catch {
      setError('確かめられませんでした')
    }
    setSaving(false)
  }

  const syncAll = async () => {
    setNote(null)
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/tasks/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      const json = (await res.json()) as {
        synced?: number
        removed?: number
        errors?: string[]
        skipped?: string
      }
      if (json.skipped) setError('先にカレンダー ID を保存して、つながるか確かめてください')
      else {
        const errs = json.errors ?? []
        setNote(
          `予定に入れた ${json.synced ?? 0} 件・外した ${json.removed ?? 0} 件` +
            (errs.length ? `・入れられなかった ${errs.length} 件（${errs[0]}）` : '')
        )
      }
    } catch {
      setError('合わせられませんでした')
    }
    setSaving(false)
    router.refresh()
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

  return (
    <div className="space-y-5">
      <Card>
        <p className="text-[13px] leading-relaxed">
          「{GCAL_TAG}」タグを付けた期限ありのやることが、Google カレンダーの予定になります。
          済ませると予定の頭に「済」が付き、消すと予定も消えます。
        </p>
      </Card>

      {!configured ? (
        <Card className="border-warn/40">
          <p className="text-[13px] text-warn">サーバーにサービスアカウントの鍵がまだありません。</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-fg-mute">
            Vercel の環境変数に GOOGLE_SA_CLIENT_EMAIL と GOOGLE_SA_PRIVATE_KEY を入れると使えます
            （docs/tasks.md）。ここで ID を保存しておくこと自体はできます。
          </p>
        </Card>
      ) : null}

      <div>
        <SectionLabel>手順</SectionLabel>
        <Card>
          <ol className="list-decimal space-y-3 pl-5 text-[13px] leading-relaxed">
            <li>
              Google カレンダー（PC のブラウザ）で、予定を入れたいカレンダーの
              「設定と共有」を開く
            </li>
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
              同じ設定画面の下にある「カレンダーの統合」から<span className="font-medium text-fg">カレンダー ID</span>
              をコピーして、下に貼る
            </li>
          </ol>
        </Card>
      </div>

      <div>
        <SectionLabel>カレンダー</SectionLabel>
        <Card>
          <div className="space-y-4">
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
              checked={enabled}
              onChange={setEnabled}
              label="予定として入れる"
              hint="OFF にすると、タグが付いていても入れません。入れてある予定はそのまま残ります"
            />
            {error ? <p className="text-xs text-danger">{error}</p> : null}
            {note ? <p className="text-xs text-fg-dim">{note}</p> : null}
            <div className="flex gap-2">
              <Button variant="primary" full onClick={() => void save()} disabled={saving}>
                保存
              </Button>
              <Button onClick={() => void probe()} disabled={saving || !calendar} className="shrink-0">
                つながるか確かめる
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <div>
        <SectionLabel>まとめて合わせる</SectionLabel>
        <Card>
          <p className="text-[12px] leading-relaxed text-fg-mute">
            つなぐ前に付けたタグのぶんや、入れられなかったものをまとめて入れ直します。
            タグが外れたものの予定は消します。
          </p>
          <Button full onClick={() => void syncAll()} disabled={saving || !calendar?.enabled} className="mt-3">
            全部合わせる
          </Button>
        </Card>
      </div>
    </div>
  )
}
