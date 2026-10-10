'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import type { BodyTab } from '@/components/body/BodyClient'
import { Labeled, LogList, LogRow, Notice, NumberInput } from '@/components/body/parts'
import { Button, Card, EmptyState, SectionLabel, StatusPill } from '@/components/ui'
import { withTapFeedback } from '@/lib/haptics'
import {
  EFFORTS,
  effortLabel,
  kindLabel,
  planText,
  type Effort,
  type PlannedExercise,
} from '@/lib/reform'
import { createClient } from '@/lib/supabase/client'
import type { BodyProfile, WorkoutSessionView } from '@/types'

/**
 * ワークアウト（マシン）。
 *
 * 今日のメニューと、やりながら付ける欄を同じ面に置く。始めてから付け終わる
 * までは続きの作業なので、間でタブを移らせない。
 *
 * 予定は実績から作られる。どうしてこの重量なのかを行ごとに出しておく。
 * 数字だけ出ていると、増えた理由が分からず、合っているのか判断できない。
 */

/** やりながら書き換える下書き。保存するまで DB には入れない */
type Draft = {
  startedAt: number
  exercises: {
    planned: PlannedExercise
    actual_weight: string
    /** セットごとの実施回数 */
    actual_reps: string[]
    actual_minutes: string
    effort: Effort
  }[]
}

export default function WorkoutPanel({
  userId,
  today,
  profile,
  plan,
  sessions,
  onJump,
}: {
  userId: string
  today: string
  profile: BodyProfile | null
  plan: PlannedExercise[] | null
  sessions: WorkoutSessionView[]
  onJump: (tab: BodyTab) => void
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 開始。予定をそのまま実績の初期値にする。できた日はそのまま押せばよい */
  const start = () => {
    if (!plan) return
    setError(null)
    setDraft({
      startedAt: Date.now(),
      exercises: plan.map((planned) => ({
        planned,
        actual_weight: planned.target_weight != null ? String(planned.target_weight) : '',
        actual_reps:
          planned.kind === 'cardio'
            ? []
            : Array(planned.target_sets ?? 2).fill(String(planned.target_reps ?? 10)),
        actual_minutes: planned.target_minutes != null ? String(planned.target_minutes) : '',
        effort: 'normal',
      })),
    })
  }

  const patch = (index: number, next: Partial<Draft['exercises'][number]>) => {
    setDraft((held) =>
      held
        ? {
            ...held,
            exercises: held.exercises.map((e, i) => (i === index ? { ...e, ...next } : e)),
          }
        : held
    )
  }

  const setRep = (index: number, set: number, value: string) => {
    setDraft((held) =>
      held
        ? {
            ...held,
            exercises: held.exercises.map((e, i) =>
              i === index
                ? { ...e, actual_reps: e.actual_reps.map((r, s) => (s === set ? value : r)) }
                : e
            ),
          }
        : held
    )
  }

  /**
   * 完了。セッションと種目をまとめて入れる。
   *
   * セッションを先に入れてから種目を入れる。種目が入らなかったときは
   * セッションを消す。予定だけ残った空の回を履歴に出さないため
   * （次回の負荷も、その空の回を「前回」として見てしまう）。
   */
  const complete = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)

    const supabase = createClient()
    const duration = Math.max(1, Math.round((Date.now() - draft.startedAt) / 60_000))

    const { data: session, error: sessionError } = await supabase
      .from('workout_sessions')
      .insert({ user_id: userId, date: today, duration })
      .select('id')
      .single()

    if (sessionError || !session) {
      setSaving(false)
      setError('保存に失敗しました')
      return
    }

    const rows = draft.exercises.map((e, position) => ({
      session_id: session.id,
      user_id: userId,
      exercise_id: e.planned.exercise_id,
      name: e.planned.name,
      kind: e.planned.kind,
      target_weight: e.planned.target_weight,
      actual_weight: e.actual_weight === '' ? null : Number(e.actual_weight),
      target_reps: e.planned.target_reps,
      actual_reps: e.actual_reps.map((r) => Number(r) || 0),
      target_sets: e.planned.target_sets,
      target_minutes: e.planned.target_minutes,
      actual_minutes: e.actual_minutes === '' ? null : Number(e.actual_minutes),
      effort: e.effort,
      reason: e.planned.reason,
      position,
    }))

    const { error: exerciseError } = await supabase.from('workout_exercises').insert(rows)

    if (exerciseError) {
      await supabase.from('workout_sessions').delete().eq('id', session.id)
      setSaving(false)
      setError('保存に失敗しました')
      return
    }

    setSaving(false)
    setDraft(null)
    router.refresh()
  }

  if (!profile || !plan) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          title="まだメニューがありません"
          description="身長・体重・年齢から、マシンの初回重量を見積もります。"
        />
        <Button full onClick={withTapFeedback(() => onJump('settings'))}>
          設定へ
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SectionLabel
          action={
            <StatusPill tone={sessions.length > 0 ? 'marine' : 'neutral'}>
              {sessions.length > 0 ? '実績ベース' : '初回推定'}
            </StatusPill>
          }
        >
          今日のメニュー
        </SectionLabel>

        <Card className="!p-3.5">
          {plan.map((planned) => (
            <div
              key={planned.exercise_id}
              className="border-b border-line-soft py-2.5 first:pt-0 last:border-b-0 last:pb-0"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[13px] font-semibold">{planned.name}</span>
                <span className="shrink-0 text-[10px] text-fg-mute">{kindLabel(planned.kind)}</span>
              </div>
              <p className="tnum mt-1 text-[12px] text-marine">{planText(planned)}</p>
              {/* どうしてこの数字なのか。増えた理由が分かるようにしておく */}
              <p className="mt-1 text-[11px] leading-relaxed text-fg-mute">{planned.reason}</p>
            </div>
          ))}

          {draft ? null : (
            <Button variant="primary" full className="mt-3.5" onClick={withTapFeedback(start)}>
              ワークアウト開始
            </Button>
          )}
        </Card>
      </div>

      {draft ? (
        <div>
          <SectionLabel action={<StatusPill tone="marine">進行中</StatusPill>}>実施記録</SectionLabel>

          <div className="flex flex-col gap-2.5">
            {draft.exercises.map((entry, index) => (
              <Card key={entry.planned.exercise_id} className="!p-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-[13px] font-semibold">
                    {entry.planned.name}
                  </span>
                  <span className="tnum shrink-0 text-[10px] text-fg-mute">
                    {index + 1}/{draft.exercises.length}
                  </span>
                </div>
                <p className="tnum mt-0.5 text-[11px] text-fg-mute">
                  予定：{planText(entry.planned)}
                </p>

                {entry.planned.kind === 'cardio' ? (
                  <div className="mt-2.5">
                    <Labeled label="実施時間 (分)">
                      <NumberInput
                        label={`${entry.planned.name}の実施時間`}
                        value={entry.actual_minutes}
                        min={0}
                        max={180}
                        onChange={(v) => patch(index, { actual_minutes: v })}
                      />
                    </Labeled>
                  </div>
                ) : (
                  <>
                    {entry.planned.kind === 'strength' ? (
                      <div className="mt-2.5">
                        <Labeled label="実施重量 (kg)">
                          <NumberInput
                            label={`${entry.planned.name}の実施重量`}
                            value={entry.actual_weight}
                            min={0}
                            step={profile.increment}
                            onChange={(v) => patch(index, { actual_weight: v })}
                          />
                        </Labeled>
                      </div>
                    ) : null}

                    <div className="mt-2.5 flex flex-col gap-2">
                      {entry.actual_reps.map((reps, set) => {
                        const target = entry.planned.target_reps ?? 0
                        const rate = target > 0 ? Math.round((Number(reps) / target) * 100) : 0
                        return (
                          <div key={set} className="flex items-center gap-2">
                            <span className="w-12 shrink-0 text-[10px] text-fg-mute">
                              SET {set + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <NumberInput
                                label={`${entry.planned.name} ${set + 1}セット目の回数`}
                                value={reps}
                                min={0}
                                max={50}
                                onChange={(v) => setRep(index, set, v)}
                              />
                            </div>
                            {/* 達成率。次回の負荷はここで決まるので、入れながら見える
                                ようにしておく */}
                            <span
                              className={`tnum w-10 shrink-0 text-right text-[11px] ${
                                rate >= 100 ? 'text-marine' : rate < 80 ? 'text-warn' : 'text-fg-mute'
                              }`}
                            >
                              {rate}%
                            </span>
                          </div>
                        )
                      })}
                    </div>

                    <div className="mt-2.5 grid grid-cols-4 gap-1.5">
                      {EFFORTS.map((effort) => (
                        <button
                          key={effort.id}
                          type="button"
                          aria-pressed={entry.effort === effort.id}
                          onClick={withTapFeedback(() => patch(index, { effort: effort.id }))}
                          className={`min-h-[36px] rounded-lg border text-[11px] transition-colors ${
                            entry.effort === effort.id
                              ? 'border-marine/70 bg-marine/10 font-medium text-marine'
                              : 'border-line text-fg-mute hover:text-fg'
                          }`}
                        >
                          {effort.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </Card>
            ))}
          </div>

          {error ? <p className="mt-2.5 text-[12px] text-danger">{error}</p> : null}

          <div className="mt-3 flex gap-2">
            <Button
              variant="ghost"
              className="shrink-0 whitespace-nowrap"
              onClick={withTapFeedback(() => setDraft(null))}
              disabled={saving}
            >
              やめる
            </Button>
            <Button
              variant="primary"
              full
              onClick={withTapFeedback(() => void complete())}
              disabled={saving}
            >
              {saving ? '保存中…' : '完了して保存'}
            </Button>
          </div>

          <p className="mt-2.5 text-[11px] leading-relaxed text-fg-mute">
            体感は次回の負荷に使います。全セット達成していても「きつい」なら上げません。
          </p>
        </div>
      ) : null}

      <div>
        <SectionLabel>最近のワークアウト</SectionLabel>
        <LogList title="実施した回" count={sessions.length}>
          {sessions.slice(0, 8).map((session) => (
            <LogRow key={session.id} date={session.date} right={`${session.duration}分`}>
              {session.exercises
                .filter((e) => e.kind !== 'cardio')
                .map((e) => (
                  <span key={e.id} className="block truncate">
                    {e.name}
                    {e.actual_weight != null ? ` ${e.actual_weight}kg` : ''}
                    {e.actual_reps.length > 0 ? ` ${e.actual_reps.join('/')}回` : ''}
                    <span className="text-fg-mute"> ({effortLabel(e.effort)})</span>
                  </span>
                ))}
            </LogRow>
          ))}
        </LogList>
      </div>

      <Notice>
        初回の重量は筋力の測定ではなく、身長・体重・年齢から安全側に寄せた推定です。実際の機械の
        表示や、その日の体調を優先してください。
      </Notice>
    </div>
  )
}
