'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Labeled, LogList, LogRow, Notice, NoteInput, NumberInput, Select } from '@/components/body/parts'
import { Button, Card, SectionLabel } from '@/components/ui'
import { withTapFeedback } from '@/lib/haptics'
import { EFFORTS, EQUIPMENTS, FREE_WEIGHT_GROUPS, effortLabel } from '@/lib/reform'
import { createClient } from '@/lib/supabase/client'
import type { FreeWeightLog } from '@/types'

/**
 * フリーウェイト。
 *
 * マシンと分けてある。こちらは自動で負荷を上げない。重さを自分で選ぶものに
 * アプリが数字を出すと、フォームが崩れたまま重くしてしまう。やったことだけ
 * 残し、次に何を持つかは本人が決める。
 */
export default function FreeWeightPanel({
  userId,
  today,
  logs,
}: {
  userId: string
  today: string
  logs: FreeWeightLog[]
}) {
  const router = useRouter()

  const [exercise, setExercise] = useState('')
  const [equipment, setEquipment] = useState<string>(EQUIPMENTS[0])
  const [weight, setWeight] = useState('10')
  const [reps, setReps] = useState('10')
  const [sets, setSets] = useState('3')
  const [effort, setEffort] = useState<string>('normal')
  const [note, setNote] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!exercise) {
      setError('種目を選んでください')
      return
    }

    setSaving(true)
    setError(null)
    const supabase = createClient()
    const { error: failed } = await supabase.from('free_weight_logs').insert({
      user_id: userId,
      date: today,
      exercise,
      equipment,
      weight: Number(weight) || 0,
      reps: Number(reps) || 0,
      sets: Number(sets) || 0,
      effort,
      note: note.trim(),
    })

    setSaving(false)
    if (failed) {
      setError('保存できませんでした')
      return
    }
    setNote('')
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SectionLabel>フリーウェイトを付ける</SectionLabel>
        <Card className="!p-3.5">
          <div className="flex flex-col gap-2.5">
            <Labeled label="種目">
              <Select value={exercise} onChange={setExercise} label="種目">
                <option value="">選んでください</option>
                {FREE_WEIGHT_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.items.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Labeled>

            <div className="grid grid-cols-2 gap-2.5">
              <Labeled label="器具">
                <Select value={equipment} onChange={setEquipment} label="器具">
                  {EQUIPMENTS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Select>
              </Labeled>
              <Labeled label="体感">
                <Select value={effort} onChange={setEffort} label="体感">
                  {EFFORTS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </Labeled>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <Labeled label="重量 (kg)">
                <NumberInput label="重量" value={weight} min={0} max={500} step={0.5} onChange={setWeight} />
              </Labeled>
              <Labeled label="回数">
                <NumberInput label="回数" value={reps} min={1} max={100} onChange={setReps} />
              </Labeled>
              <Labeled label="セット">
                <NumberInput label="セット数" value={sets} min={1} max={20} onChange={setSets} />
              </Labeled>
            </div>

            <Labeled label="メモ" hint="任意">
              <NoteInput
                value={note}
                onChange={setNote}
                placeholder="フォーム・左右差・次回の目安など"
              />
            </Labeled>
          </div>

          {error ? <p className="mt-2.5 text-[12px] text-danger">{error}</p> : null}

          <Button
            variant="primary"
            full
            className="mt-3"
            onClick={withTapFeedback(() => void save())}
            disabled={saving || !exercise}
          >
            {saving ? '保存中…' : '記録する'}
          </Button>
        </Card>
      </div>

      <LogList title="フリーウェイトの履歴" count={logs.length}>
        {logs.slice(0, 20).map((log) => (
          <LogRow key={log.id} date={log.date} right={`${log.weight}kg`}>
            <span className="block truncate">
              {log.exercise}
              <span className="text-fg-mute">｜{log.equipment}</span>
            </span>
            <span className="tnum block text-[11px] text-fg-mute">
              {log.reps}回 × {log.sets}セット｜{effortLabel(log.effort)}
            </span>
            {log.note ? <span className="block text-[11px] text-fg-mute">{log.note}</span> : null}
          </LogRow>
        ))}
      </LogList>

      <Notice>
        安全なフォームと周りの空きを確かめてから持ってください。重さを一気に増やさないほうが続きます。
      </Notice>
    </div>
  )
}
