'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button, Chip, Field, Segmented, Sheet, inputClass } from '@/components/ui'
import { withTapFeedback } from '@/lib/haptics'
import { createClient } from '@/lib/supabase/client'
import {
  DEFAULT_SUB_CATEGORY,
  SUB_CATEGORIES,
  daysUntil,
  fullDayText,
  intervalLabel,
  maxIntervalCount,
  nextPayment,
  rejectReason,
  splitInterval,
  toMonths,
  untilText,
  type IntervalUnit,
} from '@/lib/subscriptions'
import type { Subscription } from '@/types'

/** 「新しく入れる」を選んだときの値。支払い方法そのものと混ざらない文字にする */
const NEW_METHOD = '\u0000new'

/**
 * サブスクを足す・直す（0065 / 0066）。
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
  methodOptions,
  today,
  onClose,
}: {
  /** null なら新しく足す */
  sub: Subscription | null
  userId: string
  /** すでに使っているジャンル。選ぶだけで書かずに済むようにする */
  categoryOptions: string[]
  /** すでに使っている支払い方法。カードは数枚しかないので、たいてい選ぶだけで済む */
  methodOptions: string[]
  /** 日本時間の今日。契約日の初期値と、次の支払日の計算に使う */
  today: string
  onClose: () => void
}) {
  const router = useRouter()

  const [name, setName] = useState(sub?.name ?? '')
  const [plan, setPlan] = useState(sub?.plan ?? '')
  const [amount, setAmount] = useState(sub ? String(sub.amount) : '')
  // 周期は「数」と「単位」に分けて持つ。1つの数で「24か月ごと」と書かれても
  // 長さが掴めない。保存のときに月数へ直す
  const start = splitInterval(sub?.interval_months ?? 1)
  const [count, setCount] = useState(String(start.count))
  const [unit, setUnit] = useState<IntervalUnit>(start.unit)
  const [anchorOn, setAnchorOn] = useState(sub?.anchor_on ?? today)
  const [category, setCategory] = useState(sub?.category ?? DEFAULT_SUB_CATEGORY)
  const [method, setMethod] = useState(sub?.method ?? '')
  /**
   * 支払い方法を書いて入れるか。
   *
   * 1枚目を入れるときは候補が無いので、最初から書く側にしておく。
   * 候補があるのに毎回書かせると、「楽天カード」と「楽天ｶｰﾄﾞ」が並ぶ。
   */
  const [writingMethod, setWritingMethod] = useState(methodOptions.length === 0)
  const [url, setUrl] = useState(sub?.url ?? '')
  const [note, setNote] = useState(sub?.note ?? '')

  /** 入れてもらった数と単位から出した月数。保存も見出しもこれで決まる */
  const months = toMonths(Number(count), unit)

  /**
   * 次の支払日。契約日と周期から出す。
   *
   * 入れてもらうのは契約日だけにして、落ちる日はこちらで数える。
   * 「3か月ごとなら次はいつか」を人に数えさせない。
   */
  const due =
    months >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(anchorOn)
      ? nextPayment({ amount: 0, interval_months: months, anchor_on: anchorOn }, today)
      : null

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** ジャンルの候補。使っているものと、よくあるものを混ぜて重複を外す */
  const chips = [...new Set([...categoryOptions, ...SUB_CATEGORIES])]

  const save = async () => {
    const reason = rejectReason({
      name,
      amount,
      interval_months: String(months),
      anchor_on: anchorOn,
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
      plan: plan.trim(),
      amount: Math.round(Number(amount)),
      interval_months: months,
      anchor_on: anchorOn,
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

        <Field label="プラン名" hint="任意">
          <input
            type="text"
            value={plan}
            aria-label="プラン名"
            onChange={(e) => setPlan(e.target.value)}
            placeholder="スタンダード"
            className={inputClass}
          />
        </Field>

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

        {/* 周期は数と単位で入れてもらう。単位を分けるのは、2年を
            「24か月ごと」と書かれても長さが掴めないから */}
        <Field label="支払い周期" hint={months >= 1 ? intervalLabel(months) : undefined}>
          <div className="flex items-center gap-2">
            {/* inputClass が w-full を持つので、幅は外の箱で決める。
                input に w-20 を足しても w-full に負ける */}
            <div className="w-[88px] shrink-0">
              <input
                type="number"
                inputMode="numeric"
                aria-label="周期の数"
                min={1}
                max={maxIntervalCount(unit)}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className={`tnum ${inputClass}`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <Segmented
                value={unit}
                options={[
                  { id: 'month' as IntervalUnit, label: 'か月ごと' },
                  { id: 'year' as IntervalUnit, label: '年ごと' },
                ]}
                onChange={(next) => setUnit(next)}
              />
            </div>
          </div>
        </Field>

        {/* 入れてもらうのは契約日だけ。支払日はここから周期ぶんずつ進めて出す。
            契約した日なら調べずに書けるし、間違えても次の支払日を見れば気づける */}
        <Field label="契約日" hint="ここから周期ぶんずつ数えます">
          <input
            type="date"
            aria-label="契約日"
            value={anchorOn}
            onChange={(e) => setAnchorOn(e.target.value)}
            className={`tnum ${inputClass}`}
          />
          {due ? (
            <p className="mt-1.5 text-[12px] text-fg-mute">
              次の支払日
              <span className="tnum ml-1.5 text-fg-dim">{fullDayText(due)}</span>
              <span className="ml-1.5">{untilText(daysUntil(due, today))}</span>
            </p>
          ) : null}
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
          {/* 使ったことのあるものから選ぶ。カードは数枚しかないので、
              たいていは選ぶだけで済む。無ければ書いて足せる */}
          <select
            value={writingMethod ? NEW_METHOD : method}
            aria-label="支払い方法"
            onChange={(e) => {
              if (e.target.value === NEW_METHOD) {
                setWritingMethod(true)
                setMethod('')
                return
              }
              setWritingMethod(false)
              setMethod(e.target.value)
            }}
            className={`${inputClass} min-w-0`}
          >
            <option value="">選ばない</option>
            {methodOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
            <option value={NEW_METHOD}>新しく入れる…</option>
          </select>

          {writingMethod ? (
            <input
              type="text"
              value={method}
              aria-label="新しい支払い方法"
              onChange={(e) => setMethod(e.target.value)}
              placeholder="楽天カード"
              className={`mt-2 ${inputClass}`}
            />
          ) : null}
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
