'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Labeled, LogList, LogRow, Notice, NoteInput, NumberInput, Select } from '@/components/body/parts'
import { Button, Card, PillTabs, SectionLabel } from '@/components/ui'
import { withTapFeedback } from '@/lib/haptics'
import {
  CARE_KINDS,
  ESTHETIC_PARTS,
  HAIR_LEVELS,
  HAIR_PARTS,
  SKIN_STATES,
  type CareKind,
} from '@/lib/reform'
import { createClient } from '@/lib/supabase/client'
import type { BodyCareLog } from '@/types'

/**
 * ケア（脱毛・エステ・ホワイトニング）。
 *
 * 3つを1つの面にまとめてある。入れる項目がほとんど同じで、どれも
 * 「部位・時間・メモ」に収まる。別々の面にすると、同じ形の画面を3つ
 * 行き来することになる。
 *
 * 表も1枚（body_care_logs）。使う列を kind で変える（0064）。
 */
export default function CarePanel({
  userId,
  today,
  logs,
}: {
  userId: string
  today: string
  logs: BodyCareLog[]
}) {
  const router = useRouter()
  const [kind, setKind] = useState<CareKind>('hair')

  const [part, setPart] = useState<string>(HAIR_PARTS[0])
  const [minutes, setMinutes] = useState('20')
  const [level, setLevel] = useState('1')
  const [skin, setSkin] = useState<string>(SKIN_STATES[0])
  const [count, setCount] = useState('1')
  const [note, setNote] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 種別を変えたら、その種別の既定に戻す。前の部位が残っていると紛れる */
  const changeKind = (next: CareKind) => {
    setKind(next)
    setError(null)
    setPart(next === 'esthetic' ? ESTHETIC_PARTS[0] : HAIR_PARTS[0])
    setMinutes('20')
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const { error: failed } = await supabase.from('body_care_logs').insert({
      user_id: userId,
      date: today,
      kind,
      // 使わない列は空のままにする。ホワイトニングに部位は無い
      part: kind === 'whitening' ? '' : part,
      minutes: Number(minutes) || 0,
      level: kind === 'hair' ? level : '',
      skin: kind === 'hair' ? skin : '',
      count: kind === 'whitening' ? Number(count) || 1 : 1,
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

  const shown = logs.filter((log) => log.kind === kind)
  const label = CARE_KINDS.find((k) => k.id === kind)?.label ?? ''

  return (
    <div className="flex flex-col gap-5">
      {/* 3つだけだが、横に詰めると「ホワイトニング」が切れる。
          字を縮めず、入らないぶんは横に流す */}
      <PillTabs
        value={kind}
        options={CARE_KINDS.map((k) => ({ id: k.id, label: k.label }))}
        onChange={changeKind}
      />

      <div>
        <SectionLabel>{label}を付ける</SectionLabel>
        <Card className="!p-3.5">
          <div className="flex flex-col gap-2.5">
            {kind === 'whitening' ? (
              <div className="grid grid-cols-2 gap-2.5">
                <Labeled label="実施時間 (分)">
                  <NumberInput label="実施時間" value={minutes} min={1} max={60} onChange={setMinutes} />
                </Labeled>
                <Labeled label="実施回数">
                  <NumberInput label="実施回数" value={count} min={1} max={10} onChange={setCount} />
                </Labeled>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                <Labeled label="部位">
                  <Select value={part} onChange={setPart} label="部位">
                    {(kind === 'hair' ? HAIR_PARTS : ESTHETIC_PARTS).map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </Select>
                </Labeled>
                <Labeled label="実施時間 (分)">
                  <NumberInput label="実施時間" value={minutes} min={1} max={60} onChange={setMinutes} />
                </Labeled>
              </div>
            )}

            {kind === 'hair' ? (
              <div className="grid grid-cols-2 gap-2.5">
                <Labeled label="照射レベル">
                  <Select value={level} onChange={setLevel} label="照射レベル">
                    {HAIR_LEVELS.map((item) => (
                      <option key={item || 'none'} value={item}>
                        {item || '記録しない'}
                      </option>
                    ))}
                  </Select>
                </Labeled>
                <Labeled label="肌の状態">
                  <Select value={skin} onChange={setSkin} label="肌の状態">
                    {SKIN_STATES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </Select>
                </Labeled>
              </div>
            ) : null}

            <Labeled label="メモ" hint="任意">
              <NoteInput
                value={note}
                onChange={setNote}
                placeholder={
                  kind === 'hair'
                    ? '気づいたことを書いておけます'
                    : kind === 'esthetic'
                      ? '温感・ケアした場所など'
                      : '歯の状態・しみなど'
                }
              />
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

      <LogList title={`${label}の履歴`} count={shown.length}>
        {shown.slice(0, 20).map((log) => (
          <LogRow key={log.id} date={log.date} right={`${log.minutes}分`}>
            <span className="block truncate">
              {log.kind === 'whitening' ? `${log.count}回` : log.part}
              {log.level ? <span className="text-fg-mute">｜Lv.{log.level}</span> : null}
            </span>
            {log.skin && log.skin !== '問題なし' ? (
              <span className="block text-[11px] text-warn">{log.skin}</span>
            ) : null}
            {log.note ? <span className="block text-[11px] text-fg-mute">{log.note}</span> : null}
          </LogRow>
        ))}
      </LogList>

      <Notice>
        使える間隔・部位・禁忌は、置いてある機器の表示と施設の案内を優先してください。
        肌に強い刺激が出たときは続けないでください。
      </Notice>
    </div>
  )
}
