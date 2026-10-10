'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import type { BodyTab } from '@/components/body/BodyClient'
import { MiniStat, WeightSpark } from '@/components/body/parts'
import { IconFlame, IconPlus, IconPulse, IconSpark } from '@/components/icons'
import { Button, Card, EmptyState, SectionLabel, inputClass } from '@/components/ui'
import { withTapFeedback } from '@/lib/haptics'
import {
  bmi,
  daysBetween,
  planText,
  rejectWeightReason,
  sinceText,
  type PlannedExercise,
} from '@/lib/reform'
import { createClient } from '@/lib/supabase/client'
import type {
  BodyCareLog,
  BodyProfile,
  BodyWeight,
  FreeWeightLog,
  SaunaLog,
  WorkoutSessionView,
} from '@/types'

/**
 * からだのホーム。
 *
 * 開いて最初にやることは、たいてい体重を入れることなので、入力をここに置く。
 * 残りは「いまどうなっているか」だけを出し、付けるのは各面に任せる。
 */
export default function HomePanel({
  userId,
  today,
  profile,
  weights,
  latestWeight,
  sessions,
  freeWeights,
  saunaLogs,
  careLogs,
  plan,
  onJump,
}: {
  userId: string
  today: string
  profile: BodyProfile | null
  weights: BodyWeight[]
  latestWeight: number | null
  sessions: WorkoutSessionView[]
  freeWeights: FreeWeightLog[]
  saunaLogs: SaunaLog[]
  careLogs: BodyCareLog[]
  plan: PlannedExercise[] | null
  onJump: (tab: BodyTab) => void
}) {
  const lastSession = sessions.length > 0 ? sessions[0] : null
  const month = today.slice(0, 7)
  const monthCount = sessions.filter((s) => s.date.startsWith(month)).length
  const index = latestWeight && profile ? bmi(profile.height, latestWeight) : null

  const careOf = (kind: string) => careLogs.filter((c) => c.kind === kind)

  const cards: { id: BodyTab; label: string; status: string; Icon: typeof IconPulse }[] = [
    {
      id: 'workout',
      label: 'ワークアウト',
      status: lastSession ? sinceText(sessions, today) : profile ? 'メニュー作成済み' : '未設定',
      Icon: IconPulse,
    },
    { id: 'free', label: 'フリーウェイト', status: sinceText(freeWeights, today), Icon: IconFlame },
    { id: 'sauna', label: 'サウナ', status: sinceText(saunaLogs, today), Icon: IconFlame },
    { id: 'care', label: '脱毛', status: sinceText(careOf('hair'), today), Icon: IconSpark },
    { id: 'care', label: 'エステ', status: sinceText(careOf('esthetic'), today), Icon: IconSpark },
    {
      id: 'care',
      label: 'ホワイトニング',
      status: sinceText(careOf('whitening'), today),
      Icon: IconSpark,
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SectionLabel>今日</SectionLabel>
        <Card className="!p-3.5">
          <p className="text-[15px] font-semibold">
            {!profile ? (
              'プロフィールを入れてください'
            ) : lastSession ? (
              <>
                前回ワークアウトから
                <span className="tnum text-marine"> {daysBetween(lastSession.date, today)}日</span>
              </>
            ) : (
              '初回ワークアウト'
            )}
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-fg-mute">
            {!profile
              ? '身長・体重・年齢から、マシンの初回重量を見積もります。設定の面から入れてください。'
              : lastSession
                ? '直近の実績から、今日の重量と回数を決めています。'
                : '身長・体重・年齢から、安全側に寄せた初回重量を出しています。'}
          </p>
        </Card>
      </div>

      <div>
        <SectionLabel>いまの数字</SectionLabel>
        <div className="grid grid-cols-2 gap-2.5">
          <MiniStat
            label="体重"
            value={latestWeight != null ? `${latestWeight.toFixed(1)}kg` : '--'}
            sub={weights.length > 0 ? weights[0].date.slice(5).replace('-', '/') : undefined}
          />
          <MiniStat
            label="BMI"
            value={index != null ? index.toFixed(1) : '--'}
            sub={profile ? `${profile.height}cm` : undefined}
          />
          <MiniStat
            label="前回ワークアウト"
            value={lastSession ? `${daysBetween(lastSession.date, today)}日前` : '初回'}
          />
          <MiniStat label="今月ワークアウト" value={`${monthCount}回`} />
        </div>
      </div>

      <div>
        <SectionLabel>今日の体重</SectionLabel>
        <WeightInput userId={userId} today={today} />
      </div>

      <div>
        <SectionLabel>体重の推移</SectionLabel>
        <Card className="!p-3.5">
          <WeightSpark rows={weights} />
        </Card>
      </div>

      <div>
        <SectionLabel>今日のメニュー</SectionLabel>
        {plan ? (
          <Card className="!p-3.5">
            {plan.slice(0, 3).map((planned) => (
              <div
                key={planned.exercise_id}
                className="flex items-baseline justify-between gap-3 border-b border-line-soft py-2 last:border-b-0"
              >
                <span className="min-w-0 truncate text-[13px]">{planned.name}</span>
                <span className="tnum shrink-0 text-[12px] text-fg-mute">{planText(planned)}</span>
              </div>
            ))}
            <Button
              variant="primary"
              full
              className="mt-3"
              onClick={withTapFeedback(() => onJump('workout'))}
            >
              ワークアウトへ
            </Button>
          </Card>
        ) : (
          <EmptyState
            title="まだメニューがありません"
            description="設定の面で身長・体重・年齢を入れると作られます。"
          />
        )}
      </div>

      <div>
        <SectionLabel>実施メニュー</SectionLabel>
        <div className="grid grid-cols-2 gap-2.5">
          {cards.map(({ id, label, status, Icon }) => (
            <button
              key={label}
              type="button"
              onClick={withTapFeedback(() => onJump(id))}
              className="glass flex min-h-[86px] flex-col rounded-2xl p-3 text-left transition-colors hover:border-marine/50"
            >
              <Icon size={18} className="text-marine" />
              <span className="mt-1.5 block truncate text-[12px] font-semibold">{label}</span>
              <span className="mt-auto block truncate text-[10px] text-fg-mute">{status}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * 今日の体重。
 *
 * 1日1行にしてあるので、同じ日に何度入れても上書きになる（0064）。
 * 朝と夜で違う数字が2つ残るより、最後のものだけでよい。
 */
function WeightInput({ userId, today }: { userId: string; today: string }) {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const reason = rejectWeightReason(value)
    if (reason) {
      setError(reason)
      return
    }

    setSaving(true)
    setError(null)
    const supabase = createClient()
    const { error: failed } = await supabase
      .from('body_weights')
      .upsert(
        { user_id: userId, date: today, weight: Number(value) },
        { onConflict: 'user_id,date' }
      )

    setSaving(false)
    if (failed) {
      setError('保存できませんでした')
      return
    }
    setValue('')
    router.refresh()
  }

  return (
    <Card className="!p-3.5">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <span className="mb-1.5 block text-[11px] text-fg-mute">体重 (kg)</span>
          <input
            type="number"
            inputMode="decimal"
            aria-label="今日の体重"
            value={value}
            min={30}
            max={250}
            step={0.1}
            placeholder="70.2"
            onChange={(e) => setValue(e.target.value)}
            className={`tnum ${inputClass} !px-3 !py-2`}
          />
        </div>
        <Button
          variant="primary"
          onClick={withTapFeedback(() => void save())}
          disabled={saving || !value}
        >
          <IconPlus size={15} />
          {saving ? '保存中' : '入れる'}
        </Button>
      </div>
      {error ? <p className="mt-2 text-[12px] text-danger">{error}</p> : null}
      <p className="mt-2 text-[11px] leading-relaxed text-fg-mute">
        1日の増減は水分の影響が大きいので、負荷の決め方にはワークアウトの実績を優先します。
      </p>
    </Card>
  )
}
