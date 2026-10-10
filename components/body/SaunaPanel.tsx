'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Labeled, LogList, LogRow, Notice, NoteInput, NumberInput, Select } from '@/components/body/parts'
import { Button, Card, SectionLabel } from '@/components/ui'
import { withTapFeedback } from '@/lib/haptics'
import {
  COOLING_METHODS,
  SAUNA_CONDITIONS,
  SAUNA_KINDS,
  numOrNull,
  rejectSaunaReason,
} from '@/lib/reform'
import { createClient } from '@/lib/supabase/client'
import type { SaunaLog } from '@/types'

/**
 * サウナ。
 *
 * 入れる項目は多いが、必須は時間とセット数の2つだけにしてある。温度の表示が
 * ない施設もあり、全部そろうまで保存できないと、その日のぶんが残らない。
 *
 * ワークアウトと違って、次回を自動で延ばすことはしない。熱さの我慢は
 * 鍛えるものではなく、体調のほうが日によって大きく変わる。
 */
export default function SaunaPanel({
  userId,
  today,
  logs,
}: {
  userId: string
  today: string
  logs: SaunaLog[]
}) {
  const router = useRouter()

  const [kind, setKind] = useState<string>(SAUNA_KINDS[0])
  const [temperature, setTemperature] = useState('')
  const [humidity, setHumidity] = useState('')
  const [saunaMinutes, setSaunaMinutes] = useState('10')
  const [sets, setSets] = useState('3')
  const [coolingMethod, setCoolingMethod] = useState<string>(COOLING_METHODS[0])
  const [coolingMinutes, setCoolingMinutes] = useState('')
  const [waterTemperature, setWaterTemperature] = useState('')
  const [restMinutes, setRestMinutes] = useState('')
  const [loyly, setLoyly] = useState(false)
  const [loylyCount, setLoylyCount] = useState('0')
  const [condition, setCondition] = useState<string>(SAUNA_CONDITIONS[0])
  const [waterMl, setWaterMl] = useState('')
  const [note, setNote] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const reason = rejectSaunaReason({ sauna_minutes: saunaMinutes, sets })
    if (reason) {
      setError(reason)
      return
    }

    setSaving(true)
    setError(null)
    const supabase = createClient()
    const { error: failed } = await supabase.from('sauna_logs').insert({
      user_id: userId,
      date: today,
      kind,
      temperature: numOrNull(temperature),
      humidity: numOrNull(humidity),
      sauna_minutes: Number(saunaMinutes),
      sets: Number(sets),
      cooling_method: coolingMethod,
      cooling_minutes: numOrNull(coolingMinutes),
      water_temperature: numOrNull(waterTemperature),
      rest_minutes: numOrNull(restMinutes),
      loyly,
      loyly_count: loyly ? Number(loylyCount) || 0 : 0,
      condition,
      water_ml: numOrNull(waterMl),
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
        <SectionLabel>サウナを付ける</SectionLabel>
        <Card className="!p-3.5">
          <div className="flex flex-col gap-2.5">
            <Labeled label="種別">
              <Select value={kind} onChange={setKind} label="サウナの種別">
                {SAUNA_KINDS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </Labeled>

            <div className="grid grid-cols-2 gap-2.5">
              <Labeled label="サウナ時間 (分)" hint="1セット">
                <NumberInput
                  label="1セットのサウナ時間"
                  value={saunaMinutes}
                  min={1}
                  max={30}
                  onChange={setSaunaMinutes}
                />
              </Labeled>
              <Labeled label="セット数">
                <NumberInput label="セット数" value={sets} min={1} max={10} onChange={setSets} />
              </Labeled>
              <Labeled label="室温 (℃)" hint="任意">
                <NumberInput
                  label="室温"
                  value={temperature}
                  min={30}
                  max={130}
                  placeholder="表示があれば"
                  onChange={setTemperature}
                />
              </Labeled>
              <Labeled label="湿度 (%)" hint="任意">
                <NumberInput
                  label="湿度"
                  value={humidity}
                  min={0}
                  max={100}
                  placeholder="分かれば"
                  onChange={setHumidity}
                />
              </Labeled>
            </div>

            <Labeled label="冷却方法">
              <Select value={coolingMethod} onChange={setCoolingMethod} label="冷却方法">
                {COOLING_METHODS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </Labeled>

            <div className="grid grid-cols-3 gap-2.5">
              <Labeled label="冷却 (分)" hint="任意">
                <NumberInput
                  label="冷却時間"
                  value={coolingMinutes}
                  min={0}
                  max={30}
                  step={0.5}
                  placeholder="1"
                  onChange={setCoolingMinutes}
                />
              </Labeled>
              <Labeled label="水温 (℃)" hint="任意">
                <NumberInput
                  label="水風呂の水温"
                  value={waterTemperature}
                  min={0}
                  max={40}
                  step={0.1}
                  placeholder="15"
                  onChange={setWaterTemperature}
                />
              </Labeled>
              <Labeled label="休憩 (分)" hint="任意">
                <NumberInput
                  label="休憩時間"
                  value={restMinutes}
                  min={0}
                  max={60}
                  step={0.5}
                  placeholder="5"
                  onChange={setRestMinutes}
                />
              </Labeled>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <Labeled label="ロウリュ">
                <div className="flex gap-1.5">
                  {[
                    { id: false, label: 'なし' },
                    { id: true, label: 'あり' },
                  ].map((item) => (
                    <button
                      key={String(item.id)}
                      type="button"
                      aria-pressed={loyly === item.id}
                      onClick={withTapFeedback(() => setLoyly(item.id))}
                      className={`min-h-[38px] flex-1 rounded-lg border text-[12px] transition-colors ${
                        loyly === item.id
                          ? 'border-marine/70 bg-marine/10 font-medium text-marine'
                          : 'border-line text-fg-mute hover:text-fg'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </Labeled>
              <Labeled label="水分補給 (ml)" hint="任意">
                <NumberInput
                  label="水分補給"
                  value={waterMl}
                  min={0}
                  max={5000}
                  step={50}
                  placeholder="500"
                  onChange={setWaterMl}
                />
              </Labeled>
            </div>

            {/* 回数は「あり」のときだけ出す。無いときに 0 を入れさせない。
                上の2列は動かさない。押すたびに並びが変わると押し間違える */}
            {loyly ? (
              <Labeled label="ロウリュ回数">
                <NumberInput
                  label="ロウリュの回数"
                  value={loylyCount}
                  min={0}
                  max={20}
                  onChange={setLoylyCount}
                />
              </Labeled>
            ) : null}

            <Labeled label="終わったときの体調">
              <Select value={condition} onChange={setCondition} label="終わったときの体調">
                {SAUNA_CONDITIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </Labeled>

            <Labeled label="メモ" hint="任意">
              <NoteInput
                value={note}
                onChange={setNote}
                placeholder="施設名、座った段、ロウリュの強さなど"
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

      <LogList title="サウナの履歴" count={logs.length}>
        {logs.slice(0, 20).map((log) => (
          <LogRow key={log.id} date={log.date} right={`${log.sauna_minutes}分×${log.sets}`}>
            <span className="block truncate">
              {log.kind}
              {log.temperature != null ? <span className="tnum">｜{log.temperature}℃</span> : null}
            </span>
            <span className="block text-[11px] text-fg-mute">
              {log.cooling_method}
              {log.cooling_minutes != null ? ` ${log.cooling_minutes}分` : ''}
              {log.water_temperature != null ? ` ${log.water_temperature}℃` : ''}
              {log.rest_minutes != null ? `｜休憩 ${log.rest_minutes}分` : ''}
              {log.loyly ? `｜ロウリュ ${log.loyly_count}回` : ''}
            </span>
            {/* 体調は「問題なし」以外のときだけ出す。無理をした日が目に入る */}
            {log.condition && log.condition !== '問題なし' ? (
              <span className="block text-[11px] text-warn">{log.condition}</span>
            ) : null}
            {log.note ? <span className="block text-[11px] text-fg-mute">{log.note}</span> : null}
          </LogRow>
        ))}
      </LogList>

      <Notice>
        強いめまい・頭痛・息苦しさがあれば中止してください。回数や時間は、施設の案内と
        その日の体調を優先します。
      </Notice>
    </div>
  )
}
