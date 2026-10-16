'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Card, PickList, inputClassCompact } from '@/components/ui'
import { IconFast, IconPlate } from '@/components/icons'
import { createClient } from '@/lib/supabase/client'
import {
  DAY_MINUTES,
  DEFAULT_PLAN,
  DEFAULT_SLEEP,
  FAST_HOURS_CHOICES,
  SLEEP_HOURS_CHOICES,
  fastEnd,
  isAsleep,
  isFasting,
  jstMinutes,
  sleepInsideFast,
  spanText,
  toMinutes,
  wakeAt,
  type Plan,
  type Sleep,
} from '@/lib/autophagy'
import type { AutophagySettings } from '@/types'

/**
 * オートファジー（0053）のカード。
 *
 * からだの画面の中では、これだけが「いま」を出す。食べてよい時間かどうかは
 * 開いた瞬間に分かってほしいので、記録を付ける画面には混ぜず、ホームの
 * 一番上に置いている。
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

/**
 * オートファジーのカード。
 *
 * 決めてもらうのは「何時から食べないか」と「何時間か」の2つだけ。
 * 終わりは足せば出るので入れてもらわない。入力を2つ置くと、16時間の
 * つもりが15時間になっている、といった食い違いが起きる。
 */
export default function AutophagyCard({
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

  const [fastStart, setFastStart] = useState(
    timeValue(settings?.fast_start ?? DEFAULT_PLAN.fast_start)
  )
  const [fastHours, setFastHours] = useState(settings?.fast_hours ?? DEFAULT_PLAN.fast_hours)
  const [sleepStart, setSleepStart] = useState(
    timeValue(settings?.sleep_start ?? DEFAULT_SLEEP.sleep_start)
  )
  const [sleepHours, setSleepHours] = useState(settings?.sleep_hours ?? DEFAULT_SLEEP.sleep_hours)
  const [enabled, setEnabled] = useState(settings?.enabled ?? true)
  const [error, setError] = useState<string | null>(null)

  const plan: Plan = { fast_start: fastStart, fast_hours: fastHours }
  const sleep: Sleep = { sleep_start: sleepStart, sleep_hours: sleepHours }
  const minutes = jstMinutes(now)
  const fasting = isFasting(plan, minutes)
  const endAt = fastEnd(plan)
  const wake = wakeAt(sleep)
  const valid = toMinutes(fastStart) !== null && endAt !== null
  const sleepValid = toMinutes(sleepStart) !== null && wake !== null
  /** 食べない時間のうち寝ているぶん。残りどれくらい起きて我慢するかが読める */
  const asleepInFast = valid && sleepValid ? sleepInsideFast(plan, sleep) : null

  /**
   * 触ったらすぐ保存する。
   *
   * 決めるものが2つしか無いので、保存ボタンを置くと画面のぶんだけ
   * 場所を取る。押し忘れて通知が来ない、ということも無くなる。
   */
  const save = async (patch: Partial<Plan & Sleep> & { enabled?: boolean }) => {
    const nextPlan = {
      fast_start: patch.fast_start ?? fastStart,
      fast_hours: patch.fast_hours ?? fastHours,
      sleep_start: patch.sleep_start ?? sleepStart,
      sleep_hours: patch.sleep_hours ?? sleepHours,
      enabled: patch.enabled ?? enabled,
    }
    if (toMinutes(nextPlan.fast_start) === null) return
    if (toMinutes(nextPlan.sleep_start) === null) return

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
    <Card className="!p-3">
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
          {/* 残り時間ではなく時刻で出す。「あと6時間2分」では、何時までなのかを
              自分で足すことになる。時刻なら予定と突き合わせられる。
              320px に収めるため、ここは一方の時刻だけにする（帯は下に出す） */}
          <span className="mt-0.5 block truncate text-[11px] text-fg-mute">
            {enabled && valid ? (
              <>
                <span className="tnum text-fg-dim">{fasting ? endAt : fastStart}</span>
                {fasting ? 'まで食べられません' : 'から食べられません'}
                {/* そのうち何時間を寝て過ごすか。書かないと、まるごと
                    空腹の時間に見える */}
                {asleepInFast ? (
                  <span className="ml-1.5">（うち睡眠{spanText(asleepInFast)}）</span>
                ) : null}
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
        <div className="mt-2.5">
          <DayBar plan={plan} sleep={sleepValid ? sleep : null} minutes={minutes} enabled={enabled} />
        </div>
      ) : null}

      {/* 決めるのは始まりと長さだけ。終わりは足して出す。
          1行に収めるため、余白も文字も詰めてある。区切り線は引かない。
          帯との間が空いていれば、別のものだと分かる */}
      <div className="mt-5 flex flex-wrap items-center gap-x-1.5 gap-y-2">
        <input
          type="time"
          value={fastStart}
          aria-label="食べない時間の始まり"
          onChange={(e) => {
            setFastStart(e.target.value)
            void save({ fast_start: e.target.value })
          }}
          // 文字は 16px のまま。これより小さいと iOS が画面を拡大する
          className={`${inputClassCompact} tnum !w-[100px] !min-w-0 shrink-0 px-2 py-1.5`}
        />
        {/* 「から」だけでは何が始まるのか書いていない。時刻の欄が
            食べない時間の始まりだと、ここで言い切る。
            1行に収まらない幅では「スタート」を落とす。意味は変わらない */}
        <span className="shrink-0 text-[11px] text-fg-mute">
          から断食<span className="max-[379px]:hidden">スタート</span>
        </span>

        {/* 時間数は右端へ。決めるものが2つだと分かり、押す的も端に寄って大きくなる */}
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
                className={`tnum h-7 rounded-full px-1.5 text-[11px] transition-colors ${
                  on ? 'bg-marine font-medium text-ink' : 'text-fg-mute hover:text-marine'
                }`}
              >
                {hours}
              </button>
            )
          })}
          {/* 320px では「時間」まで入らない。数字の意味は左の「断食」で分かる */}
          <span className="pr-1.5 pl-0.5 text-[10px] text-fg-mute max-[339px]:hidden">時間</span>
        </div>
      </div>

      {/* 睡眠。断食の行と同じ作りにして、読み方を覚え直さずに済ませる */}
      <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-2">
        <input
          type="time"
          value={sleepStart}
          aria-label="寝る時刻"
          onChange={(e) => {
            setSleepStart(e.target.value)
            void save({ sleep_start: e.target.value })
          }}
          className={`${inputClassCompact} tnum !w-[100px] !min-w-0 shrink-0 px-2 py-1.5`}
        />
        <span className="shrink-0 text-[11px] text-fg-mute">
          から睡眠<span className="max-[379px]:hidden">。起床 </span>
          <span className="tnum max-[379px]:hidden">{wake ?? '--:--'}</span>
        </span>

        {/* 6〜12の7つ。横に並べると押し分けられる幅にならないので、
            一覧から選んでもらう */}
        <div className="ml-auto w-[104px] shrink-0">
          <PickList
            compact
            label="睡眠時間"
            value={String(sleepHours)}
            onChange={(next) => {
              setSleepHours(Number(next))
              void save({ sleep_hours: Number(next) })
            }}
            options={SLEEP_HOURS_CHOICES.map((hours) => ({
              id: String(hours),
              label: `${hours}時間`,
            }))}
          />
        </div>
      </div>

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
function DayBar({
  plan,
  sleep,
  minutes,
  enabled,
}: {
  plan: Plan
  /** 読めない値のときは出さない */
  sleep: Sleep | null
  minutes: number
  enabled: boolean
}) {
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
        className={`relative h-2 overflow-hidden rounded-full border border-line ${
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
        {/* 寝ている時間。食べない時間の上に薄く重ねる。16時間のうち
            どこを寝て過ごすのかが、帯の見た目で分かる */}
        {sleep
          ? [...Array(DAY_MINUTES).keys()]
              .filter((i) => isAsleep(sleep, i) && (i === 0 || !isAsleep(sleep, i - 1)))
              .map((from) => {
                let to = from
                while (to < DAY_MINUTES && isAsleep(sleep, to)) to += 1
                return (
                  <span
                    key={from}
                    className={`absolute inset-y-0 ${enabled ? 'bg-teal/35' : 'bg-white/[0.06]'}`}
                    style={{ left: pct(from), width: pct(to - from) }}
                  />
                )
              })
          : null}

        <span
          className="absolute inset-y-0 w-0.5 bg-fg"
          style={{ left: pct(minutes) }}
          aria-hidden="true"
        />
      </div>

      <div className="mt-0.5 flex justify-between text-[9px] text-fg-mute">
        <span>0</span>
        <span>6</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  )
}
