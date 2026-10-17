'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Labeled, LogList, LogRow, Notice, NoteInput, NumberInput } from '@/components/body/parts'
import { Button, Card, SectionLabel } from '@/components/ui'
import { withTapFeedback } from '@/lib/haptics'
import { numOrNull, rejectWalkReason } from '@/lib/reform'
import { createClient } from '@/lib/supabase/client'
import type { WalkLog } from '@/types'

/**
 * 散歩（0072）。
 *
 * 必須は歩いた時間だけにしてある。距離も歩数も、測っていない日がある。
 * 全部そろうまで保存できないと、その日のぶんが残らない。
 *
 * ワークアウトと違って、次回の目標を出すことはしない。散歩に「前回より
 * 長く」と言われると、続けるための行為ではなくなる。
 */
export default function WalkPanel({
  userId,
  today,
  logs,
}: {
  userId: string
  today: string
  logs: WalkLog[]
}) {
  const router = useRouter()

  const [minutes, setMinutes] = useState('30')
  const [distance, setDistance] = useState('')
  const [steps, setSteps] = useState('')
  const [note, setNote] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 今月の合計。続いているかどうかだけが見たいので、回数と時間を出す */
  const month = today.slice(0, 7)
  const thisMonth = logs.filter((log) => log.date.startsWith(month))
  const monthMinutes = thisMonth.reduce((sum, log) => sum + log.minutes, 0)

  const save = async () => {
    const reason = rejectWalkReason({ minutes })
    if (reason) {
      setError(reason)
      return
    }

    setSaving(true)
    setError(null)
    const supabase = createClient()

    // 1日に何度でも入れられる。朝と夕方に別々に歩く日がある
    const { error: failed } = await supabase.from('walk_logs').insert({
      user_id: userId,
      date: today,
      minutes: Number(minutes),
      distance_km: numOrNull(distance),
      steps: numOrNull(steps),
      note: note.trim(),
    })

    setSaving(false)
    if (failed) {
      setError('保存できませんでした')
      return
    }
    setDistance('')
    setSteps('')
    setNote('')
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SectionLabel>今月</SectionLabel>
        <Card className="!p-3.5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <span className="block text-[11px] text-fg-mute">歩いた回数</span>
              <span className="tnum block text-[28px] leading-none font-semibold text-marine">
                {thisMonth.length}
                <span className="ml-1 text-[14px]">回</span>
              </span>
            </div>
            <div className="text-right">
              <span className="block text-[11px] text-fg-mute">合計</span>
              <span className="tnum block text-[15px] font-semibold">{monthMinutes}分</span>
            </div>
          </div>
        </Card>
      </div>

      <div>
        <SectionLabel>今日の散歩</SectionLabel>
        <Card className="!p-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="歩いた時間 (分)">
              <NumberInput label="歩いた時間" value={minutes} min={1} max={480} onChange={setMinutes} />
            </Labeled>

            <Labeled label="距離 (km)" hint="任意">
              <NumberInput
                label="距離"
                value={distance}
                min={0}
                max={99}
                step={0.1}
                onChange={setDistance}
              />
            </Labeled>

            <Labeled label="歩数" hint="任意">
              <NumberInput label="歩数" value={steps} min={0} max={200000} onChange={setSteps} />
            </Labeled>
          </div>

          <div className="mt-3">
            <Labeled label="メモ" hint="任意">
              <NoteInput value={note} onChange={setNote} placeholder="コース、天気、一緒に歩いた人" />
            </Labeled>
          </div>

          {error ? <p className="mt-2.5 text-[12px] text-danger">{error}</p> : null}

          <Button
            variant="primary"
            full
            className="mt-3"
            onClick={withTapFeedback(() => void save())}
            disabled={saving}
          >
            {saving ? '保存中…' : '記録する'}
          </Button>
        </Card>
      </div>

      <LogList title="散歩の履歴" count={logs.length}>
        {logs.slice(0, 20).map((log) => (
          <LogRow key={log.id} date={log.date} right={`${log.minutes}分`}>
            <span className="block truncate">
              {log.distance_km != null ? <span className="tnum">{log.distance_km}km</span> : null}
              {log.distance_km != null && log.steps != null ? '｜' : null}
              {log.steps != null ? <span className="tnum">{log.steps}歩</span> : null}
              {log.distance_km == null && log.steps == null ? '時間のみ' : null}
            </span>
            {log.note ? <span className="block text-[11px] text-fg-mute">{log.note}</span> : null}
          </LogRow>
        ))}
      </LogList>

      <Notice>
        続けることが目的なので、前回より長く歩く必要はありません。距離も歩数も、測った日だけ
        入れてください。
      </Notice>
    </div>
  )
}
