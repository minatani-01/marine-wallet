'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import SubSheet from '@/components/subs/SubSheet'
import { IconExternal, IconPlus } from '@/components/icons'
import { Card, EmptyState, SectionLabel } from '@/components/ui'
import { yen } from '@/lib/format'
import { withTapFeedback } from '@/lib/haptics'
import { createClient } from '@/lib/supabase/client'
import {
  byCategory,
  dayText,
  daysUntil,
  intervalLabel,
  nextPayment,
  sortByNext,
  totals,
  untilText,
} from '@/lib/subscriptions'
import type { Subscription } from '@/types'

/**
 * サブスクの一覧（0065 / 0066）。
 *
 * まず合計を出す。1つずつの額は小さくても、足すと毎月それだけ出ていく、
 * というのがこの画面の存在理由なので、そこを一番上に置く。
 *
 * 次に、近いものから順に並べる。「今月もう落ちたか」「次はいつか」が
 * 分かれば、見直す日を決められる。
 *
 * 止めたものは下にまとめる。消さずに残しておくと、また同じものを
 * 申し込みそうになったときに気づける。
 */
export default function SubsClient({
  userId,
  subs,
  today,
}: {
  userId: string
  subs: Subscription[]
  /** サーバーが出した日本時間の今日 */
  today: string
}) {
  const router = useRouter()

  /** 編集中。null は「追加」で開いたとき。閉じているあいだは undefined */
  const [editing, setEditing] = useState<Subscription | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  /**
   * 押した直後の状態。サーバーに書いて読み直すまでのあいだ、これを先に出す。
   *
   * 待たせると、押したのに動かなかったのかと思ってもう一度押す。
   * 新しい一覧が届いたら捨てて、サーバーの値に戻す。
   */
  const [flipped, setFlipped] = useState<Record<string, boolean>>({})
  useEffect(() => setFlipped({}), [subs])

  const rows = useMemo(
    () => subs.map((sub) => (sub.id in flipped ? { ...sub, active: flipped[sub.id] } : sub)),
    [subs, flipped]
  )

  const living = useMemo(() => rows.filter((sub) => sub.active), [rows])
  const stopped = useMemo(() => rows.filter((sub) => !sub.active), [rows])
  const ordered = useMemo(() => sortByNext(living, today), [living, today])
  const sum = useMemo(() => totals(rows), [rows])
  const shares = useMemo(() => byCategory(rows), [rows])

  const categories = useMemo(
    () => [...new Set(subs.map((sub) => sub.category))].filter(Boolean),
    [subs]
  )

  /** すでに使っている支払い方法。同じカードを何度も書かずに済ませる */
  const methods = useMemo(
    () =>
      [...new Set(subs.map((sub) => sub.method))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'ja')),
    [subs]
  )

  /**
   * 使う・止めるを札のまま切り替える。
   *
   * 消さずに印を変えるだけ。解約したことも記録のうちで、消してしまうと、
   * また同じものを申し込んだときに気づけない。
   */
  const toggleActive = async (sub: Subscription) => {
    const next = !sub.active
    setFlipped((all) => ({ ...all, [sub.id]: next }))
    setError(null)

    const supabase = createClient()
    const { error: failed } = await supabase
      .from('subscriptions')
      .update({ active: next })
      .eq('id', sub.id)

    if (failed) {
      // 戻す。押したとおりに見えたまま直っていない、が一番まずい
      setFlipped((all) => {
        const rest = { ...all }
        delete rest[sub.id]
        return rest
      })
      setError('変えられませんでした')
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-5 pb-16">
      <div>
        <SectionLabel>出ていくお金</SectionLabel>
        <Card className="!p-3.5">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <span className="block text-[11px] text-fg-mute">ひと月あたり</span>
              <span className="tnum block text-[28px] leading-none font-semibold text-marine">
                {yen(sum.monthly)}
              </span>
            </div>
            <div className="shrink-0 text-right">
              <span className="block text-[11px] text-fg-mute">1年で</span>
              <span className="tnum block text-[15px] font-semibold">{yen(sum.yearly)}</span>
            </div>
          </div>

          {/* ジャンルごとの内訳。何に効いているかが分かる */}
          {shares.length > 0 ? (
            <div className="mt-3 border-t border-line-soft pt-3">
              <div className="flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                {shares.map((share, index) => (
                  <span
                    key={share.category}
                    className={index % 2 === 0 ? 'bg-marine' : 'bg-teal'}
                    style={{ width: `${(share.monthly / Math.max(1, sum.monthly)) * 100}%` }}
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {shares.map((share) => (
                  <span key={share.category} className="text-[11px] text-fg-mute">
                    {share.category}
                    <span className="tnum ml-1 text-fg-dim">{yen(share.monthly)}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <p className="mt-2.5 text-[11px] text-fg-mute">
            周期で割ってひと月あたりに直しています。止めたものは数えません。
          </p>
        </Card>
      </div>

      {error ? <p className="text-[12px] text-danger">{error}</p> : null}

      <div>
        <SectionLabel>
          {living.length > 0 ? `使っているもの ${living.length}件` : '使っているもの'}
        </SectionLabel>

        {living.length === 0 ? (
          <EmptyState
            title="まだ登録がありません"
            description="右下の + から、払っているものを入れておけます。"
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {ordered.map((sub) => {
              const due = nextPayment(sub, today)
              const days = daysUntil(due, today)
              return (
                <Row
                  key={sub.id}
                  sub={sub}
                  due={due}
                  days={days}
                  onEdit={() => setEditing(sub)}
                  onToggle={() => void toggleActive(sub)}
                />
              )
            })}
          </div>
        )}
      </div>

      {stopped.length > 0 ? (
        <div>
          <SectionLabel>止めたもの {stopped.length}件</SectionLabel>
          <div className="flex flex-col gap-2.5">
            {stopped.map((sub) => (
              <Row
                key={sub.id}
                sub={sub}
                onEdit={() => setEditing(sub)}
                onToggle={() => void toggleActive(sub)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* 追加は右下に浮かせる。一覧を見ているときに押すものなので、
          上まで戻らせない */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-lg justify-end px-4">
        <button
          type="button"
          aria-label="サブスクを追加"
          onClick={withTapFeedback(() => setEditing(null))}
          className="pointer-events-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-marine text-ink shadow-[0_10px_30px_-8px_rgba(34,211,238,0.8)] transition-colors hover:bg-teal"
        >
          <IconPlus size={24} />
        </button>
      </div>

      {editing !== undefined ? (
        <SubSheet
          sub={editing}
          userId={userId}
          categoryOptions={categories}
          methodOptions={methods}
          today={today}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </div>
  )
}

/**
 * 1件ぶんの札。
 *
 * 押すと編集。右端に使う・止めるのスイッチを置く。見直すのは一覧を
 * 眺めているときなので、そこから1回で止められるようにする。
 *
 * 解約ページを入れてあるものは、その隣から直接開ける。アプリで止めても
 * 請求は止まらないので、本当に解約するにはそちらへ行くことになる。
 */
function Row({
  sub,
  due,
  days,
  onEdit,
  onToggle,
}: {
  sub: Subscription
  due?: string
  days?: number
  onEdit: () => void
  onToggle: () => void
}) {
  // 1週間を切ったら色を付ける。見直すなら落ちる前である
  const near = typeof days === 'number' && days <= 7

  return (
    <div className="glass flex items-center overflow-hidden rounded-2xl">
      <button
        type="button"
        onClick={withTapFeedback(onEdit)}
        aria-label={`${sub.name}を編集`}
        className={`flex min-w-0 flex-1 items-center gap-3 py-3.5 pr-2 pl-3.5 text-left transition-colors hover:bg-white/[0.03] ${
          sub.active ? '' : 'opacity-55'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 truncate text-[14px] font-semibold">{sub.name}</span>
            {/* プラン名はサービス名に続けて小さく出す。同じサービスで
                契約が分かれているとき、どちらの話か札だけで分かる */}
            {sub.plan ? (
              <span className="min-w-0 truncate text-[11px] text-fg-dim">{sub.plan}</span>
            ) : null}
            <span className="ml-auto shrink-0 text-[10px] text-fg-mute">{sub.category}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[11px] text-fg-mute">
            <span>{intervalLabel(sub.interval_months)}</span>
            {due ? (
              <span className={near ? 'text-warn' : 'text-fg-dim'}>
                <span className="tnum">{dayText(due)}</span>
                <span className="ml-1">{untilText(days ?? 0)}</span>
              </span>
            ) : null}
            {sub.method ? <span className="truncate">{sub.method}</span> : null}
          </div>
          {sub.note ? <p className="mt-1 truncate text-[11px] text-fg-mute">{sub.note}</p> : null}
        </div>

        <span className="tnum shrink-0 text-right text-[15px] font-semibold text-marine">
          {yen(sub.amount)}
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1.5 py-3.5 pr-3 pl-1.5">
        {sub.url ? (
          <a
            href={sub.url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`${sub.name}の管理ページを開く`}
            title="管理・解約のページを開く"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line text-fg-mute transition-colors hover:border-marine/60 hover:text-marine"
          >
            <IconExternal size={14} />
          </a>
        ) : null}

        {/* 使っているかどうか。消さずに印を変えるだけなので、戻すのも1回 */}
        <button
          type="button"
          role="switch"
          aria-checked={sub.active}
          aria-label={`${sub.name}を使う`}
          onClick={withTapFeedback(onToggle)}
          className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
            sub.active ? 'border-marine/70 bg-marine/30' : 'border-line bg-white/[0.04]'
          }`}
        >
          <span
            className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-all ${
              sub.active ? 'left-[24px] bg-marine' : 'left-[3px] bg-fg-mute'
            }`}
          />
        </button>
      </div>
    </div>
  )
}
