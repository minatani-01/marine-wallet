'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button, Card, Field, SectionLabel, Toggle, inputClass } from '@/components/ui'
import { IconFast, IconPlate } from '@/components/icons'
import { createClient } from '@/lib/supabase/client'
import {
  DEFAULT_WINDOW,
  eatingMinutes,
  fastingMinutes,
  isEating,
  jstMinutes,
  nextBoundary,
  spanText,
  toMinutes,
  type Window,
} from '@/lib/autophagy'
import type { AutophagySettings } from '@/types'

/**
 * からだ（ダイエット・美容・トレーニング）の画面。
 *
 * いまは1つめの機能（オートファジー）だけ。あとから体重や運動の記録を
 * 足せるよう、画面は「カードを縦に並べる」形にしてある。
 */

/** 'HH:MM:SS' でも 'HH:MM' でも、input[type=time] が読める形にする */
function timeValue(value: string): string {
  return value.slice(0, 5)
}

/**
 * いまの時刻。分が変わるたびに数え直す。
 *
 * 30秒ごとに見に行く形だと、残り時間の表示が最大30秒ずれる。
 * 次の分ちょうどまで待ってから、1分ごとに切り替える。
 */
function useNow(initial: string): Date {
  // サーバーが描いた時刻をそのまま初期値にする。ここで new Date() を使うと、
  // サーバーの描画とブラウザの最初の描画で文字が食い違う（ハイドレーションのずれ）
  const [now, setNow] = useState(() => new Date(initial))

  useEffect(() => {
    // 画面が出たらすぐ、ブラウザの時計に合わせ直す
    setNow(new Date())

    let interval: ReturnType<typeof setInterval> | null = null
    const toNextMinute = (60 - new Date().getSeconds()) * 1000

    const timeout = setTimeout(() => {
      setNow(new Date())
      interval = setInterval(() => setNow(new Date()), 60_000)
    }, toNextMinute)

    return () => {
      clearTimeout(timeout)
      if (interval) clearInterval(interval)
    }
  }, [])

  return now
}

export default function BodyClient({
  userId,
  settings,
  nowIso,
}: {
  userId: string
  settings: AutophagySettings | null
  /** サーバーが描いた時刻。最初の描画をブラウザと揃えるために受け取る */
  nowIso: string
}) {
  const router = useRouter()
  const now = useNow(nowIso)

  const [enabled, setEnabled] = useState(settings?.enabled ?? true)
  const [eatStart, setEatStart] = useState(
    timeValue(settings?.eat_start ?? DEFAULT_WINDOW.eat_start)
  )
  const [eatEnd, setEatEnd] = useState(timeValue(settings?.eat_end ?? DEFAULT_WINDOW.eat_end))
  const [notifyEat, setNotifyEat] = useState(settings?.notify_eat ?? true)
  const [notifyFast, setNotifyFast] = useState(settings?.notify_fast ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const window: Window = useMemo(
    () => ({ eat_start: eatStart, eat_end: eatEnd }),
    [eatStart, eatEnd]
  )

  const minutes = jstMinutes(now)
  const eating = isEating(window, minutes)
  const next = nextBoundary(window, minutes)
  const eatLength = eatingMinutes(window)
  const fastLength = fastingMinutes(window)
  const valid = toMinutes(eatStart) !== null && toMinutes(eatEnd) !== null

  // 保存していない変更があるか。あるうちだけ保存ボタンを出す
  const dirty =
    enabled !== (settings?.enabled ?? true) ||
    eatStart !== timeValue(settings?.eat_start ?? DEFAULT_WINDOW.eat_start) ||
    eatEnd !== timeValue(settings?.eat_end ?? DEFAULT_WINDOW.eat_end) ||
    notifyEat !== (settings?.notify_eat ?? true) ||
    notifyFast !== (settings?.notify_fast ?? true) ||
    // 行がまだ無いときは、既定のままでも一度保存させる（通知はここから始まる）
    settings === null

  const save = async () => {
    if (!valid) return
    setSaving(true)
    setError(null)

    const supabase = createClient()
    const { error: failed } = await supabase.from('autophagy_settings').upsert(
      {
        user_id: userId,
        enabled,
        eat_start: eatStart,
        eat_end: eatEnd,
        notify_eat: notifyEat,
        notify_fast: notifyFast,
      },
      { onConflict: 'user_id' }
    )

    setSaving(false)
    if (failed) {
      setError('保存に失敗しました')
      return
    }
    setSaved(true)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      {/* いまどちらの時間か。開いた瞬間にこれだけ分かればよい */}
      <Card className="glow">
        <div className="flex items-start gap-3">
          <span
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${
              eating
                ? 'border-marine/50 bg-marine/10 text-marine'
                : 'border-line bg-white/[0.03] text-fg-mute'
            }`}
          >
            {eating ? <IconPlate size={20} /> : <IconFast size={20} />}
          </span>

          <div className="min-w-0 flex-1">
            <div className="eyebrow">オートファジー</div>
            <p
              className={`mt-1 text-[26px] leading-tight font-semibold ${
                eating ? 'text-marine' : 'text-fg'
              }`}
            >
              {enabled ? (eating ? '食べてOK' : '断食中') : 'お休み中'}
            </p>
            {enabled && next ? (
              <p className="mt-1 text-[12px] text-fg-mute">
                {next.kind === 'fast' ? '断食まで' : '食べられるまで'}{' '}
                <span className="tnum text-fg-dim">{spanText(next.inMinutes)}</span>
                <span className="tnum"> （{next.at}）</span>
              </p>
            ) : (
              <p className="mt-1 text-[12px] text-fg-mute">
                {enabled ? '時間を決めると、始まりと終わりに通知します。' : '通知は止めています。'}
              </p>
            )}
          </div>
        </div>

        {/* 1日の帯。食べてよい時間を marine で塗る */}
        {valid ? (
          <div className="mt-4 border-t border-line pt-4">
            <DayBar window={window} minutes={minutes} enabled={enabled} />
            <div className="mt-2 flex items-center justify-between text-[11px] text-fg-mute">
              <span>
                食事 <span className="tnum text-marine">{spanText(eatLength ?? 0)}</span>
              </span>
              <span>
                断食 <span className="tnum text-fg-dim">{spanText(fastLength ?? 0)}</span>
              </span>
            </div>
          </div>
        ) : null}
      </Card>

      {/* 時間の設定 */}
      <div>
        <SectionLabel>食べてよい時間</SectionLabel>
        <Card className="mt-3">
          {/* time の入力は中身ぶんの幅を持とうとする。min-w-0 を付けないと
              320px で2つ並べたときにはみ出す */}
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field label="始まり">
                <input
                  type="time"
                  value={eatStart}
                  onChange={(e) => {
                    setEatStart(e.target.value)
                    setSaved(false)
                  }}
                  className={`${inputClass} tnum !min-w-0 px-2.5`}
                />
              </Field>
            </div>
            <span className="shrink-0 pb-3 text-fg-mute">〜</span>
            <div className="min-w-0 flex-1">
              <Field label="終わり">
                <input
                  type="time"
                  value={eatEnd}
                  onChange={(e) => {
                    setEatEnd(e.target.value)
                    setSaved(false)
                  }}
                  className={`${inputClass} tnum !min-w-0 px-2.5`}
                />
              </Field>
            </div>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-fg-mute">
            終わりが始まりより早いときは翌日になります。18:00〜02:00 なら、
            夜のうちに食べて、2:00 から夕方まで空ける形です。
          </p>

          <div className="mt-3 border-t border-line pt-1">
            <Toggle
              checked={enabled}
              onChange={(next) => {
                setEnabled(next)
                setSaved(false)
              }}
              label="オートファジーを使う"
              hint="止めているあいだは通知もしません"
            />
            <Toggle
              checked={notifyEat}
              onChange={(next) => {
                setNotifyEat(next)
                setSaved(false)
              }}
              disabled={!enabled}
              label="食べてよい時間になったら知らせる"
              hint={`${timeValue(eatStart)} に通知します`}
            />
            <Toggle
              checked={notifyFast}
              onChange={(next) => {
                setNotifyFast(next)
                setSaved(false)
              }}
              disabled={!enabled}
              label="食べない時間になったら知らせる"
              hint={`${timeValue(eatEnd)} に通知します`}
            />
          </div>

          {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}

          {dirty || saving ? (
            <Button
              variant="primary"
              full
              className="mt-4"
              disabled={saving || !valid}
              onClick={save}
            >
              {saving ? '保存中' : '保存する'}
            </Button>
          ) : saved ? (
            <p className="mt-4 text-center text-[12px] text-marine">保存しました</p>
          ) : null}
        </Card>
      </div>

      <p className="text-[11px] leading-relaxed text-fg-mute">
        通知は端末ごとに許可が要ります。マイページの「通知」で受け取る設定にしてください。
      </p>
    </div>
  )
}

/**
 * 1日ぶんの帯。
 *
 * 0時から24時までを左から右に並べ、食べてよい時間を塗る。日をまたぐ設定では
 * 帯が両端に分かれる。数字だけ並べるより、どれくらい空いているかが目で分かる。
 */
function DayBar({
  window,
  minutes,
  enabled,
}: {
  window: Window
  minutes: number
  enabled: boolean
}) {
  const start = toMinutes(window.eat_start)
  const end = toMinutes(window.eat_end)
  if (start === null || end === null) return null

  const pct = (m: number) => `${(m / 1440) * 100}%`
  // 日をまたぐときは2本に分かれる
  const spans =
    start < end
      ? [{ from: start, to: end }]
      : start === end
        ? [{ from: 0, to: 1440 }]
        : [
            { from: start, to: 1440 },
            { from: 0, to: end },
          ]

  return (
    <div className="relative h-7">
      <div className="absolute inset-x-0 top-1.5 h-4 overflow-hidden rounded-md border border-line bg-white/[0.02]">
        {spans.map((span) => (
          <span
            key={`${span.from}-${span.to}`}
            className={enabled ? 'absolute inset-y-0 bg-marine/35' : 'absolute inset-y-0 bg-fg-mute/20'}
            style={{ left: pct(span.from), width: pct(span.to - span.from) }}
          />
        ))}
        {/* いまの位置 */}
        <span
          className="absolute inset-y-0 w-0.5 bg-fg"
          style={{ left: pct(minutes) }}
          aria-hidden="true"
        />
      </div>

      <div className="absolute inset-x-0 top-0 flex justify-between text-[9px] text-fg-mute">
        <span>0</span>
        <span>6</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  )
}
