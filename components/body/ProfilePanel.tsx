'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Labeled, Notice, NumberInput, Select } from '@/components/body/parts'
import { Button, Card, SectionLabel } from '@/components/ui'
import { withTapFeedback } from '@/lib/haptics'
import { GOALS, INCREMENTS, numOrNull, rejectProfileReason } from '@/lib/reform'
import { createClient } from '@/lib/supabase/client'
import type { BodyProfile } from '@/types'

/**
 * プロフィールと、負荷の決め方の説明。
 *
 * ここを入れるまでワークアウトのメニューは作らない。身長・体重・年齢が
 * 無いまま初回の重量を置くと、安全でない数字が出る。
 */
export default function ProfilePanel({
  userId,
  today,
  profile,
}: {
  userId: string
  today: string
  profile: BodyProfile | null
}) {
  const router = useRouter()

  const [height, setHeight] = useState(profile ? String(profile.height) : '')
  const [weight, setWeight] = useState(profile ? String(profile.weight) : '')
  const [age, setAge] = useState(profile ? String(profile.age) : '')
  const [goal, setGoal] = useState<string>(profile?.goal ?? 'health')
  const [targetWeight, setTargetWeight] = useState(
    profile?.target_weight != null ? String(profile.target_weight) : ''
  )
  const [increment, setIncrement] = useState(String(profile?.increment ?? 5))

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const reason = rejectProfileReason({ height, weight, age })
    if (reason) {
      setError(reason)
      return
    }

    setSaving(true)
    setError(null)
    setSaved(false)
    const supabase = createClient()

    const { error: failed } = await supabase.from('body_profiles').upsert(
      {
        user_id: userId,
        height: Number(height),
        weight: Number(weight),
        age: Number(age),
        goal,
        target_weight: numOrNull(targetWeight),
        increment: Number(increment),
      },
      { onConflict: 'user_id' }
    )

    if (failed) {
      setSaving(false)
      setError('保存できませんでした')
      return
    }

    /**
     * 今日の体重としても入れておく。
     *
     * ここで入れた体重が推移に出ないと、設定したのに「記録なし」のままに
     * 見える。1日1行なので、あとで量り直せば上書きになる。
     */
    await supabase
      .from('body_weights')
      .upsert({ user_id: userId, date: today, weight: Number(weight) }, { onConflict: 'user_id,date' })

    setSaving(false)
    setSaved(true)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SectionLabel>プロフィール</SectionLabel>
        <Card className="!p-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            <Labeled label="身長 (cm)">
              <NumberInput label="身長" value={height} min={120} max={230} onChange={setHeight} />
            </Labeled>
            <Labeled label="体重 (kg)">
              <NumberInput
                label="体重"
                value={weight}
                min={30}
                max={250}
                step={0.1}
                onChange={setWeight}
              />
            </Labeled>
            <Labeled label="年齢">
              <NumberInput label="年齢" value={age} min={18} max={100} onChange={setAge} />
            </Labeled>
            <Labeled label="目的">
              <Select value={goal} onChange={setGoal} label="目的">
                {GOALS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Labeled>
            <Labeled label="目標体重 (kg)" hint="任意">
              <NumberInput
                label="目標体重"
                value={targetWeight}
                min={30}
                max={250}
                step={0.1}
                onChange={setTargetWeight}
              />
            </Labeled>
            <Labeled label="マシンの刻み">
              <Select value={increment} onChange={setIncrement} label="マシンの重量の刻み">
                {INCREMENTS.map((item) => (
                  <option key={item} value={String(item)}>
                    {item}kg
                  </option>
                ))}
              </Select>
            </Labeled>
          </div>

          {error ? <p className="mt-2.5 text-[12px] text-danger">{error}</p> : null}
          {saved && !error ? (
            <p className="mt-2.5 text-[12px] text-marine">保存しました。メニューを作り直しました</p>
          ) : null}

          <Button
            variant="primary"
            full
            className="mt-3"
            onClick={withTapFeedback(() => void save())}
            disabled={saving}
          >
            {saving ? '保存中…' : '保存してメニューを作り直す'}
          </Button>
        </Card>
      </div>

      <div>
        <SectionLabel>初回の決め方</SectionLabel>
        <Card className="!p-3.5">
          <p className="text-[11px] leading-relaxed text-fg-mute">
            負荷計算用の体重 = 実体重と BMI25 相当の体重の小さいほう。そこへ年齢の係数をかけ、
            種目ごとの割合を当て、マシンの刻みに切り下げます。
          </p>
          <div className="mt-2.5 flex flex-col gap-1 border-t border-line-soft pt-2.5 text-[11px] text-fg-dim">
            <span className="tnum">レッグプレス ×0.60</span>
            <span className="tnum">チェストプレス ×0.25</span>
            <span className="tnum">ラットプルダウン ×0.25</span>
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-fg-mute">
            初回は10回×2セット。2回目からは、前回の実績（達成率と体感、空いた日数）だけで
            決めます。
          </p>
        </Card>
      </div>

      <Notice>
        ワークアウトの初回重量は筋力の測定ではなく、安全側に寄せたアプリの推定です。美容系の機器や
        サウナについては、アプリの記録よりも、置いてある機器の使い方・禁忌・施設の案内を
        優先してください。
      </Notice>
    </div>
  )
}
