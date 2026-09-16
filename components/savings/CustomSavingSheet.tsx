'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Amount, Button, Chip, Field, Sheet, inputClassCompact } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { today } from '@/lib/format'
import { tapFeedback } from '@/lib/haptics'
import type { SavingCustomPreset, SavingEntryRow } from '@/types'

const QUICK_AMOUNTS = [300, 500, 1000, 3000]

/**
 * カスタム登録（試合結果から自動計算できない分を積み立てる）。
 * saving_entries に kind='custom' / game_id=null で保存する。
 *
 * NPB 公式から取得できない項目はここで登録する。
 * 定型を選ぶと、その名前と金額が入る。定型は貯金ルールの画面で増やせる。
 * 珍記録のように決まった金額が無いものは、そのまま手で入力する。
 *
 * 中身はチームの出来事そのものなので、一緒に貯めている人と共有する。
 * ここで書くのは自分の行だけだが、DB のトリガー（saving_entries_share_custom）が
 * 同じ内容を全員ぶんに広げる。編集も削除も同じように全員に届く。
 * 誰が登録してもよく、マスターかどうかは関係しない。
 */

export default function CustomSavingSheet({
  entry,
  presets,
  userId,
  onClose,
}: {
  entry: SavingEntryRow | null
  /** 貯金ルールの画面で増やせる定型 */
  presets: SavingCustomPreset[]
  userId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [date, setDate] = useState(entry?.entry_date ?? today())
  const [title, setTitle] = useState(entry?.title ?? '')
  const [amount, setAmount] = useState(entry ? String(entry.amount) : '')
  const [note, setNote] = useState(entry?.other_note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * 手で選べる定型だけを出す。
   *
   * 「名球会記録 / 生涯記録 / シーズン記録」は npb.jp から取れるので
   * 自動登録に移した。選択肢に残すと、自動で入るものを手でも入れてしまう。
   */
  const selectable = presets.filter((p) => !p.auto)

  const parsedAmount = Math.max(0, Number.parseInt(amount || '0', 10) || 0)
  const canSubmit = title.trim().length > 0 && parsedAmount > 0 && Boolean(date)

  /** 定型を選んだら、その他と金額をその場で埋める（どちらも後から直せる） */
  const applyPreset = (preset: SavingCustomPreset) => {
    tapFeedback()
    setTitle(preset.label)
    setAmount(String(preset.amount))
  }

  const save = async () => {
    if (!canSubmit) return
    setSaving(true)
    setError(null)

    const payload = {
      user_id: userId,
      game_id: null,
      kind: 'custom' as const,
      title: title.trim(),
      entry_date: date,
      amount: parsedAmount,
      breakdown: [{ key: 'custom', label: title.trim(), amount: parsedAmount }],
      other_amount: 0,
      other_note: note.trim(),
    }

    const supabase = createClient()
    const { error } = entry
      ? await supabase.from('saving_entries').update(payload).eq('id', entry.id)
      : await supabase.from('saving_entries').insert(payload)

    setSaving(false)
    if (error) {
      setError('保存に失敗しました')
      return
    }
    onClose()
    router.refresh()
  }

  return (
    <Sheet
      title={entry ? 'カスタム登録を編集' : 'カスタム登録'}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {error ? <p className="text-[13px] text-danger">{error}</p> : null}
          <Button variant="primary" full onClick={save} disabled={saving || !canSubmit}>
            {saving ? '保存中' : entry ? '更新する' : 'この内容で貯金する'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="日付">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputClassCompact}
            />
          </Field>

          <Field label="定型" hint="貯金ルールで追加">
            <select
              value={selectable.find((p) => p.label === title)?.id ?? ''}
              onChange={(e) => {
                const preset = selectable.find((p) => p.id === e.target.value)
                if (preset) applyPreset(preset)
              }}
              className={inputClassCompact}
              disabled={selectable.length === 0}
            >
              <option value="">
                {selectable.length === 0 ? '定型がありません' : '選択しない'}
              </option>
              {selectable.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}　¥{preset.amount.toLocaleString()}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="その他" hint="定型を選ぶと入ります">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例: 代打逆転満塁ホームラン"
            className={inputClassCompact}
          />
        </Field>

        <Field label="金額">
          <div className="flex flex-col gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className={`${inputClassCompact} tnum`}
            />
            <div className="grid grid-cols-4 gap-2">
              {QUICK_AMOUNTS.map((v) => (
                <Chip key={v} selected={parsedAmount === v} onClick={() => setAmount(String(v))}>
                  ¥{v.toLocaleString()}
                </Chip>
              ))}
            </div>
          </div>
        </Field>

        <Field label="メモ" hint="任意">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="残しておきたいこと"
            className={inputClassCompact}
          />
        </Field>

        <div className="glass rounded-2xl p-4 text-center">
          <div className="eyebrow">積立額</div>
          <div className="mt-2">
            <Amount value={parsedAmount} size="lg" tone="marine" />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-fg-mute">
            カスタム登録にフェーズ倍率は適用されません。
            <br />
            内容と金額は一緒に貯めているメンバー全員に反映されます。
          </p>
        </div>
      </div>
    </Sheet>
  )
}
