'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Card, SectionLabel, inputClassCompact } from '@/components/ui'
import { IconFast, IconPlate } from '@/components/icons'
import { createClient } from '@/lib/supabase/client'
import {
  DEFAULT_PLAN,
  FAST_HOURS_CHOICES,
  fastEnd,
  isFasting,
  jstMinutes,
  nextBoundary,
  spanText,
  toMinutes,
  type Plan,
} from '@/lib/autophagy'
import type { AutophagySettings } from '@/types'

/**
 * からだ（ダイエット・美容・トレーニング）の画面。
 *
 * オートファジーはここの1つめでしかない。体重も運動も並べていくので、
 * 1つの機能が画面を占領しないようカード1枚に収める。縦に伸ばすより、
 * 状態と設定を同じカードの中で詰める。
 */

/** 'HH:MM:SS' でも 'HH:MM' でも、input[type=time] が読める形にする */
function timeValue(value: string): string {
  return value.slice(0, 5)
}

/**
 * いまの時刻。分が変わるたびに数え直す。
 *
 * サーバーが描いた時刻を初期値にする。ここで new Date() を使うと、
 * サーバーの描画とブラウザの最初の描画で文字が食い違う。
 */
function useNow(initial: string): Date {
  const [now, setNow] = useState(() => new Date(initial))

  useEffect(() => {
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
  const now = useNow(nowIso)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SectionLabel>オートファジー</SectionLabel>
        <div className="mt-2.5">
          <AutophagyCard userId={userId} settings={settings} now={now} />
        </div>
      </div>
    </div>
  )
}

/**
 * オートファジーのカード。
 *
 * 決めてもらうのは「何時から食べないか」と「何時間か」の2つだけ。
 * 終わりは足せば出るので入れてもらわない。入力を2つ置くと、16時間の
 * つもりが15時間になっている、といった食い違いが起きる。
 */
function AutophagyCard({
  userId,
  settings,
  now,
}: {
  userId: string
  settings: AutophagySettings | null
  now: Date
}) {
  const router = useRouter()

  const [fastStart, setFastStart] = useState(
    timeValue(settings?.fast_start ?? DEFAULT_PLAN.fast_start)
  )
  const [fastHours, setFastHours] = useState(settings?.fast_hours ?? DEFAULT_PLAN.fast_hours)
  const [enabled, setEnabled] = useState(settings?.enabled ?? true)
  const [error, setError] = useState<string | null>(null)

  const plan: Plan = { fast_start: fastStart, fast_hours: fastHours }
  const minutes = jstMinutes(now)
  const fasting = isFasting(plan, minutes)
  const next = nextBoundary(plan, minutes)
  const endAt = fastEnd(plan)
  const valid = toMinutes(fastStart) !== null && endAt !== null

  /**
   * 触ったらすぐ保存する。
   *
   * 決めるものが2つしか無いので、保存ボタンを置くと画面のぶんだけ
   * 場所を取る。押し忘れて通知が来ない、ということも無くなる。
   */
  const save = async (patch: Partial<Plan> & { enabled?: boolean }) => {
    const nextPlan = {
      fast_start: patch.fast_start ?? fastStart,
      fast_hours: patch.fast_hours ?? fastHours,
      enabled: patch.enabled ?? enabled,
    }
    if (toMinutes(nextPlan.fast_start) === null) return

    setError(null)
    const supabase = createClient()
    const { error: failed } = await supabase
      .from('autophagy_settings')
      .upsert({ user_id: userId, ...nextPlan }, { onConflict: 'user_id' })

    if (failed) {
      setError('保存できませんでした')
      return
    }
    router.refresh()
  }

  return (
    <Card className="!p-3.5">
      {/* いまどちらの時間か。開いた瞬間にこれだけ分かればよい */}
      <div className="flex items-center gap-2.5">
        <span
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
            enabled && fasting
              ? 'border-line bg-white/[0.03] text-fg-mute'
              : 'border-marine/50 bg-marine/10 text-marine'
          }`}
        >
          {enabled && fasting ? <IconFast size={17} /> : <IconPlate size={17} />}
        </span>

        {/* 状態と残り時間を縦に積む。横に並べると、320px で状態のほうが
            折り返して2行になり、そちらが読みにくくなる */}
        <div className="min-w-0 flex-1">
          <span
            className={`block truncate text-[15px] font-semibold ${
              !enabled ? 'text-fg-mute' : fasting ? 'text-fg' : 'text-marine'
            }`}
          >
            {!enabled ? 'お休み中' : fasting ? '食べない時間' : '食べてOK'}
          </span>
          {/* 機能の名前は上の見出しに出してある。ここは残り時間だけにする。
              320px では両方入らず、肝心の残り時間のほうが切れる */}
          <span className="mt-0.5 block truncate text-[11px] text-fg-mute">
            {enabled && next && valid ? (
              <>
                あと<span className="tnum text-fg-dim">{spanText(next.inMinutes)}</span>
                {next.kind === 'eat' ? 'で解禁' : 'で断食'}
              </>
            ) : (
              '時間を決めると通知します'
            )}
          </span>
        </div>

        {/* 使うかどうか。止めているあいだは通知もしない */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="オートファジーを使う"
          onClick={() => {
            const flipped = !enabled
            setEnabled(flipped)
            void save({ enabled: flipped })
          }}
          className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
            enabled ? 'border-marine/70 bg-marine/30' : 'border-line bg-white/[0.04]'
          }`}
        >
          <span
            className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-all ${
              enabled ? 'left-[24px] bg-marine' : 'left-[3px] bg-fg-mute'
            }`}
          />
        </button>
      </div>

      {/* 1日の帯。食べない時間を落とし、いまの位置を線で出す */}
      {valid ? (
        <div className="mt-3">
          <DayBar plan={plan} minutes={minutes} enabled={enabled} />
        </div>
      ) : null}

      {/* 決めるのは始まりと長さだけ。終わりは足して出す */}
      <div className="mt-3 flex items-center gap-2 border-t border-line-soft pt-3">
        <input
          type="time"
          value={fastStart}
          aria-label="食べない時間の始まり"
          onChange={(e) => {
            setFastStart(e.target.value)
            void save({ fast_start: e.target.value })
          }}
          // 端末の時計が12時間表示だと「02:00 AM」と出る。切れない幅を取る
          className={`${inputClassCompact} tnum !w-[108px] !min-w-0 shrink-0 px-2`}
        />
        <span className="shrink-0 text-[11px] text-fg-mute">から</span>

        <div className="ml-auto flex shrink-0 items-center rounded-full border border-line p-0.5">
          {FAST_HOURS_CHOICES.map((hours) => {
            const on = hours === fastHours
            return (
              <button
                key={hours}
                type="button"
                aria-pressed={on}
                aria-label={`${hours}時間`}
                onClick={() => {
                  setFastHours(hours)
                  void save({ fast_hours: hours })
                }}
                className={`tnum h-7 rounded-full px-2 text-[11px] transition-colors ${
                  on ? 'bg-marine font-medium text-ink' : 'text-fg-mute hover:text-marine'
                }`}
              >
                {hours}
              </button>
            )
          })}
          <span className="pr-1.5 pl-0.5 text-[10px] text-fg-mute">時間</span>
        </div>
      </div>

      <p className="mt-2 text-[11px] text-fg-mute">
        {valid ? (
          <>
            <span className="tnum text-fg-dim">
              {fastStart}〜{endAt}
            </span>
            {' は食べません。解禁は '}
            <span className="tnum text-marine">{endAt}</span>
            {'。始まりと終わりに通知します。'}
          </>
        ) : (
          '時間を決めると、始まりと終わりに通知します。'
        )}
      </p>

      {error ? <p className="mt-2 text-[12px] text-danger">{error}</p> : null}
    </Card>
  )
}

/**
 * 1日ぶんの帯。
 *
 * 0時から24時までを左から右に並べ、食べない時間を落とす。日をまたぐ設定では
 * 帯が両端に分かれる。数字だけ並べるより、どれくらい空くかが目で分かる。
 */
function DayBar({ plan, minutes, enabled }: { plan: Plan; minutes: number; enabled: boolean }) {
  const start = toMinutes(plan.fast_start)
  const end = toMinutes(fastEnd(plan) ?? '')
  if (start === null || end === null) return null

  const pct = (m: number) => `${(m / 1440) * 100}%`
  // 日をまたぐときは2本に分かれる
  const spans =
    start < end
      ? [{ from: start, to: end }]
      : [
          { from: start, to: 1440 },
          { from: 0, to: end },
        ]

  return (
    <div className="relative">
      {/* 地の色が食事。落としたところが食べない時間 */}
      <div
        className={`relative h-2.5 overflow-hidden rounded-full border border-line ${
          enabled ? 'bg-marine/30' : 'bg-white/[0.04]'
        }`}
      >
        {spans.map((span) => (
          <span
            key={`${span.from}-${span.to}`}
            className="absolute inset-y-0 bg-ink"
            style={{ left: pct(span.from), width: pct(span.to - span.from) }}
          />
        ))}
        <span
          className="absolute inset-y-0 w-0.5 bg-fg"
          style={{ left: pct(minutes) }}
          aria-hidden="true"
        />
      </div>

      <div className="mt-1 flex justify-between text-[9px] text-fg-mute">
        <span>0</span>
        <span>6</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  )
}
