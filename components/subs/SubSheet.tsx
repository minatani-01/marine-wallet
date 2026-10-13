'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button, Chip, Field, Segmented, Sheet, inputClass } from '@/components/ui'
import { withTapFeedback } from '@/lib/haptics'
import { createClient } from '@/lib/supabase/client'
import {
  CYCLES,
  DEFAULT_SUB_CATEGORY,
  SUB_CATEGORIES,
  rejectReason,
  type Cycle,
} from '@/lib/subscriptions'
import type { Subscription } from '@/types'

/**
 * サブスクを足す・直す（0065）。
 *
 * 必須はサービス名と金額と支払日だけ。思い出したときに名前と額だけ
 * 入れておけるほうが、全部そろうまで入れられないより残る。
 *
 * 「止める」は消さずに外すだけにする。解約したことも記録のうちで、
 * 消してしまうと、また同じものを申し込んだときに気づけない。
 */
export default function SubSheet({
  sub,
  userId,
  categoryOptions,
  onClose,
}: {
  /** null なら新しく足す */
  sub: Subscription | null
  userId: string
  /** すでに使っているジャンル。選ぶだけで書かずに済むようにする */
  categoryOptions: string[]
  onClose: () => void
}) {
  const router = useRouter()

  const [name, setName] = useState(sub?.name ?? '')
  const [amount, setAmount] = useState(sub ? String(sub.amount) : '')
  const [cycle, setCycle] = useState<Cycle>((sub?.cycle as Cycle) ?? 'monthly')
  const [billingDay, setBillingDay] = useState(String(sub?.billing_day ?? 1))
  const [billingMonth, setBillingMonth] = useState(
    sub?.billing_month != null ? String(sub.billing_month) : '1'
  )
  const [category, setCategory] = useState(sub?.category ?? DEFAULT_SUB_CATEGORY)
  const [method, setMethod] = useState(sub?.method ?? '')
  const [url, setUrl] = useState(sub?.url ?? '')
  const [note, setNote] = useState(sub?.note ?? '')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** ジャンルの候補。使っているものと、よくあるものを混ぜて重複を外す */
  const chips = [...new Set([...categoryOptions, ...SUB_CATEGORIES])]

  const save = async () => {
    const reason = rejectReason({
      name,
      amount,
      billing_day: billingDay,
      cycle,
      billing_month: billingMonth,
      url,
    })
    if (reason) {
      setError(reason)
      return
    }

    setSaving(true)
    setError(null)
    const supabase = createClient()

    const payload = {
      user_id: userId,
      name: name.trim(),
      amount: Math.round(Number(amount)),
      cycle,
      billing_day: Number(billingDay),
      // 毎月のときは持たない。残すと、周期を戻したときに古い月が効いてしまう
      billing_month: cycle === 'yearly' ? Number(billingMonth) : null,
      category: category.trim() || DEFAULT_SUB_CATEGORY,
      method: method.trim(),
      url: url.trim(),
      note: note.trim(),
    }

    const { error: failed } = sub
      ? await supabase.from('subscriptions').update(payload).eq('id', sub.id)
      : await supabase.from('subscriptions').insert(payload)

    setSaving(false)
    if (failed) {
      setError('保存に失敗しました')
      return
    }

    onClose()
    router.refresh()
  }

  /** 止める・また使う。消さずに印を変えるだけ */
  const toggleActive = async () => {
    if (!sub) return
    setSaving(true)
    const supabase = createClient()
    const { error: failed } = await supabase
      .from('subscriptions')
      .update({ active: !sub.active })
      .eq('id', sub.id)

    setSaving(false)
    if (failed) {
      setError('変えられませんでした')
      return
    }
    onClose()
    router.refresh()
  }

  return (
    <Sheet
      title={sub ? 'サブスクを編集' : 'サブスクを追加'}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {error ? <p className="text-[12px] text-danger">{error}</p> : null}
          <div className="flex gap-2">
            {sub ? (
              <Button
                variant={sub.active ? 'danger' : 'outline'}
                className="shrink-0 whitespace-nowrap"
                onClick={withTapFeedback(() => void toggleActive())}
                disabled={saving}
              >
                {sub.active ? '止める' : '使う'}
              </Button>
            ) : null}
            <Button
              variant="primary"
              full
              onClick={withTapFeedback(() => void save())}
              disabled={saving || !name.trim()}
            >
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="サービス名">
          <input
            type="text"
            value={name}
            aria-label="サービス名"
            onChange={(e) => setName(e.target.value)}
            placeholder="Netflix"
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="金額" hint="1回ぶん">
            <input
              type="number"
              inputMode="numeric"
              aria-label="金額"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1590"
              className={`tnum ${inputClass}`}
            />
          </Field>
          <Field label="周期">
            <Segmented
              value={cycle}
              options={CYCLES.map((c) => ({ id: c.id, label: c.label }))}
              onChange={(next) => setCycle(next)}
            />
          </Field>
        </div>

        <Field
          label="支払日"
          hint={cycle === 'yearly' ? '毎年いつか' : '無い日は末日に寄せます'}
        >
          <div className={cycle === 'yearly' ? 'grid grid-cols-2 gap-3' : ''}>
            {cycle === 'yearly' ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  inputMode="numeric"
                  aria-label="支払月"
                  min={1}
                  max={12}
                  value={billingMonth}
                  onChange={(e) => setBillingMonth(e.target.value)}
                  className={`tnum ${inputClass}`}
                />
                <span className="shrink-0 text-[13px] text-fg-mute">月</span>
              </div>
            ) : null}
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                inputMode="numeric"
                aria-label="支払日"
                min={1}
                max={31}
                value={billingDay}
                onChange={(e) => setBillingDay(e.target.value)}
                className={`tnum ${inputClass}`}
              />
              <span className="shrink-0 text-[13px] text-fg-mute">日</span>
            </div>
          </div>
        </Field>

        <Field label="ジャンル" hint="書いたものが候補に増えます">
          <div className="mb-2 flex flex-wrap gap-2">
            {chips.map((item) => (
              <Chip key={item} selected={category === item} onClick={() => setCategory(item)}>
                {item}
              </Chip>
            ))}
          </div>
          <input
            type="text"
            value={category}
            aria-label="ジャンル"
            onChange={(e) => setCategory(e.target.value)}
            placeholder={DEFAULT_SUB_CATEGORY}
            className={inputClass}
          />
        </Field>

        <Field label="支払い方法" hint="任意">
          <input
            type="text"
            value={method}
            aria-label="支払い方法"
            onChange={(e) => setMethod(e.target.value)}
            placeholder="楽天カード"
            className={inputClass}
          />
        </Field>

        <Field label="管理・解約のページ" hint="任意">
          <input
            type="url"
            inputMode="url"
            aria-label="管理・解約のページ"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            className={inputClass}
          />
        </Field>

        <Field label="メモ" hint="任意">
          <textarea
            value={note}
            aria-label="メモ"
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="家族で共有。来年の更新前に見直す"
            className={`${inputClass} resize-none`}
          />
        </Field>
      </div>
    </Sheet>
  )
}
