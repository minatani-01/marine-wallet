'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar, Button, Chip, Field, Segmented, Sheet, inputClass } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { notifyPartner } from '@/lib/notify-client'
import { withTapFeedback } from '@/lib/haptics'
import { distributeEqual, distributeRatio } from '@/lib/warikan'
import { today, yen } from '@/lib/format'
import { EXPENSE_CATEGORIES } from '@/lib/constants'
import type {
  ExpenseCategory,
  MarineLinkView,
  Share,
  SplitMemberView,
  SplitRecord,
  SplitStatus,
  SplitType,
} from '@/types'

const SPLIT_TYPES: { id: SplitType; label: string }[] = [
  { id: 'equal', label: '均等' },
  { id: 'ratio', label: '比率' },
  { id: 'amount', label: '金額' },
]

export default function SplitSheet({
  record,
  members,
  links,
  userId,
  onClose,
}: {
  record: SplitRecord | null
  members: SplitMemberView[]
  /** 接続している相手。登録したことを知らせる先を引くのに使う */
  links: MarineLinkView[]
  userId: string
  onClose: () => void
}) {
  const router = useRouter()
  const memberNames = useMemo(() => members.map((m) => m.name), [members])

  /**
   * 参加している人のうち、接続しているアカウントのIDを集める。
   *
   * メンバーは Marine ID で接続と結びつく。ID を登録していない人
   * （アプリを使っていない人）には送りようがないので、そのまま飛ばす。
   */
  const partnerIdsIn = (names: string[]): string[] => {
    const ids = new Set<string>()
    for (const name of names) {
      const marineId = members.find((m) => m.name === name)?.marine_id
      if (!marineId) continue
      const link = links.find(
        (l) =>
          l.status === 'accepted' &&
          l.partner_marine_id.trim().toUpperCase() === marineId.trim().toUpperCase()
      )
      if (link) ids.add(link.partner_id)
    }
    return [...ids]
  }

  const [date, setDate] = useState(record?.date ?? today())
  const [targetDate, setTargetDate] = useState(record?.target_date ?? '')
  const [content, setContent] = useState(record?.content ?? '')
  const [amount, setAmount] = useState(record ? String(record.amount) : '')
  const [category, setCategory] = useState<ExpenseCategory>(record?.category ?? 'other')
  const [status, setStatus] = useState<SplitStatus>(record?.status ?? 'unpaid')
  const [splitType, setSplitType] = useState<SplitType>(record?.split_type ?? 'equal')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 参加メンバー（既存記録があればその shares の顔ぶれを復元する）
  const [selected, setSelected] = useState<string[]>(() => {
    if (record?.shares?.length) return record.shares.map((s) => s.member)
    return memberNames
  })
  const [payer, setPayer] = useState(record?.payer ?? memberNames[0] ?? '')

  const [ratioInputs, setRatioInputs] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    if (record?.split_type === 'ratio') {
      for (const share of record.shares ?? []) {
        initial[share.member] = share.value != null ? String(share.value) : ''
      }
    }
    return initial
  })
  const [amountInputs, setAmountInputs] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    if (record?.split_type === 'amount') {
      for (const share of record.shares ?? []) initial[share.member] = String(share.burden)
    }
    return initial
  })

  useEffect(() => {
    setPayer((prev) => (selected.includes(prev) ? prev : (selected[0] ?? '')))
  }, [selected])

  const parsedAmount = Number.parseInt(amount, 10) || 0

  const equalBurdens = useMemo(
    () => distributeEqual(parsedAmount, selected.length),
    [parsedAmount, selected.length]
  )

  const ratioValues = useMemo(
    () => selected.map((name) => Number.parseFloat(ratioInputs[name] ?? '') || 0),
    [selected, ratioInputs]
  )
  const ratioTotal = ratioValues.reduce((sum, v) => sum + v, 0)
  const ratioBurdens = useMemo(() => {
    if (ratioTotal <= 0) return selected.map(() => 0)
    return distributeRatio(parsedAmount, ratioValues)
  }, [parsedAmount, ratioValues, ratioTotal, selected])

  const amountBurdens = selected.map((name) => Number.parseInt(amountInputs[name] ?? '', 10) || 0)
  const amountSum = amountBurdens.reduce((sum, v) => sum + v, 0)
  const amountDiff = parsedAmount - amountSum

  const burdenOf = (index: number) => {
    if (splitType === 'equal') return equalBurdens[index] ?? 0
    if (splitType === 'ratio') return ratioBurdens[index] ?? 0
    return amountBurdens[index] ?? 0
  }

  const buildShares = (): Share[] =>
    selected.map((name, i) => ({
      member: name,
      value:
        splitType === 'equal'
          ? null
          : splitType === 'ratio'
            ? (ratioValues[i] ?? 0)
            : (amountBurdens[i] ?? 0),
      burden: burdenOf(i),
    }))

  const canSubmit =
    Boolean(date) &&
    content.trim().length > 0 &&
    parsedAmount > 0 &&
    selected.length >= 2 &&
    Boolean(payer) &&
    (splitType !== 'amount' || amountDiff === 0) &&
    (splitType !== 'ratio' || ratioTotal > 0)

  const toggleMember = (name: string) => {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    )
  }

  const save = async () => {
    if (!canSubmit) return
    setSaving(true)
    setError(null)

    const shares = buildShares()
    if (shares.reduce((sum, s) => sum + s.burden, 0) !== parsedAmount) {
      setError('負担額の合計が金額と一致していません')
      setSaving(false)
      return
    }

    const payload = {
      user_id: userId,
      date,
      // 空のままなら入れない。払った日がそのまま対象の日、という記録のほうが多い
      target_date: targetDate || null,
      content: content.trim(),
      amount: parsedAmount,
      payer,
      status,
      split_type: splitType,
      member_count: shares.length,
      shares,
      category,
    }

    const supabase = createClient()
    const { error } = record
      ? await supabase.from('records').update(payload).eq('id', record.id)
      : await supabase.from('records').insert(payload)

    setSaving(false)
    if (error) {
      setError('保存に失敗しました')
      return
    }

    // 登録したことを、その割り勘に入っている接続相手へ知らせる。
    // 編集では鳴らさない。金額を直すたびに通知が飛ぶと煩わしい
    if (!record) {
      for (const partnerId of partnerIdsIn(selected)) {
        notifyPartner('split_added', partnerId)
      }
    }

    onClose()
    router.refresh()
  }

  const smallInput =
    'tnum w-24 rounded-lg border border-line bg-ink-2/80 px-2.5 py-1.5 text-right text-fg outline-none focus:border-marine/70'

  return (
    <Sheet
      title={record ? '支出を編集' : '支出を登録'}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {error ? <p className="text-[13px] text-danger">{error}</p> : null}
          {selected.length < 2 ? (
            <p className="text-[13px] text-warn">参加メンバーを2人以上選んでください</p>
          ) : null}
          <Button variant="primary" full onClick={save} disabled={saving || !canSubmit}>
            {saving ? '保存中' : record ? '更新する' : '登録する'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="決済した日">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </Field>

        {/* 行く日と払う日が違うときだけ入れる。コンビニで買ったものまで
            二度入れさせると手間が増えるだけなので、空でよいことにする */}
        <Field label="何月何日分か（任意）">
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className={inputClass}
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-fg-mute">
            観戦日や予約日など、払った日と違うときに入れます。
            空のままなら決済した日だけを出します。
          </p>
        </Field>

        <Field label="内容">
          <input
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="例: ZOZOマリン 内野指定席"
            className={inputClass}
          />
        </Field>

        <Field label="金額">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className={`${inputClass} tnum`}
          />
        </Field>

        <Field label="カテゴリ" hint="観戦支出の集計に使います">
          <div className="grid grid-cols-3 gap-2">
            {EXPENSE_CATEGORIES.map((c) => (
              <Chip key={c.id} selected={category === c.id} onClick={() => setCategory(c.id)}>
                {c.label}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="参加メンバー" hint={`${selected.length}人`}>
          {memberNames.length === 0 ? (
            <p className="text-[13px] text-warn">
              メンバーが登録されていません。メンバー画面から追加してください。
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const on = selected.includes(m.name)
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMember(m.name)}
                    aria-pressed={on}
                    className={`flex min-h-[44px] items-center gap-2 rounded-xl border px-3 text-sm transition-colors ${
                      on
                        ? 'border-marine/70 bg-marine/10 text-marine'
                        : 'border-line bg-white/[0.02] text-fg-mute'
                    }`}
                  >
                    <Avatar name={m.name} src={m.avatar_url} selected={on} size={24} />
                    <span className="truncate">{m.name}</span>
                  </button>
                )
              })}
            </div>
          )}
        </Field>

        <Field label="決済者">
          <select
            value={payer}
            onChange={withTapFeedback((e) => setPayer(e.target.value))}
            className={inputClass}
          >
            {selected.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="割り勘方法">
          <div className="flex flex-col gap-2">
            <Segmented value={splitType} options={SPLIT_TYPES} onChange={setSplitType} />

            <div className="flex flex-col gap-2 rounded-xl border border-line bg-white/[0.02] p-3">
              {selected.length === 0 ? (
                <p className="text-[13px] text-fg-mute">参加メンバーを選ぶと負担額を計算します</p>
              ) : (
                selected.map((name, i) => (
                  <div key={name} className="flex items-center gap-2">
                    <span className="flex-1 truncate text-sm">{name}</span>

                    {splitType === 'equal' ? (
                      <span className="tnum text-sm text-fg-dim">{yen(equalBurdens[i] ?? 0)}</span>
                    ) : null}

                    {splitType === 'ratio' ? (
                      <>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          value={ratioInputs[name] ?? ''}
                          onChange={(e) =>
                            setRatioInputs((prev) => ({ ...prev, [name]: e.target.value }))
                          }
                          placeholder="0"
                          className={`${smallInput} w-16`}
                        />
                        <span className="tnum w-24 text-right text-sm text-fg-dim">
                          {yen(ratioBurdens[i] ?? 0)}
                        </span>
                      </>
                    ) : null}

                    {splitType === 'amount' ? (
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={amountInputs[name] ?? ''}
                        onChange={(e) =>
                          setAmountInputs((prev) => ({ ...prev, [name]: e.target.value }))
                        }
                        placeholder="0"
                        className={smallInput}
                      />
                    ) : null}
                  </div>
                ))
              )}

              {splitType === 'ratio' ? (
                <p className="text-right text-[11px] text-fg-mute">比率合計 {ratioTotal}</p>
              ) : null}

              {splitType === 'amount' ? (
                <p className={`text-right text-[11px] ${amountDiff === 0 ? 'text-teal' : 'text-warn'}`}>
                  {amountDiff === 0
                    ? '合計金額と一致しています'
                    : amountDiff > 0
                      ? `不足 ${yen(amountDiff)}`
                      : `超過 ${yen(Math.abs(amountDiff))}`}
                </p>
              ) : null}
            </div>
          </div>
        </Field>

        <Field label="ステータス">
          <Segmented
            value={status}
            options={[
              { id: 'unpaid', label: '未精算' },
              { id: 'paid', label: '精算済み' },
            ]}
            onChange={setStatus}
          />
        </Field>
      </div>
    </Sheet>
  )
}
