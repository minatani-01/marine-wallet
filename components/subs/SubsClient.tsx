'use client'

import { useMemo, useState } from 'react'

import SubSheet from '@/components/subs/SubSheet'
import { IconExternal, IconPlus } from '@/components/icons'
import { Card, EmptyState, SectionLabel } from '@/components/ui'
import { yen } from '@/lib/format'
import { withTapFeedback } from '@/lib/haptics'
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
  /** 編集中。null は「追加」で開いたとき。閉じているあいだは undefined */
  const [editing, setEditing] = useState<Subscription | null | undefined>(undefined)

  const living = useMemo(() => subs.filter((sub) => sub.active), [subs])
  const stopped = useMemo(() => subs.filter((sub) => !sub.active), [subs])
  const ordered = useMemo(() => sortByNext(living, today), [living, today])
  const sum = useMemo(() => totals(subs), [subs])
  const shares = useMemo(() => byCategory(subs), [subs])

  const categories = useMemo(
    () => [...new Set(subs.map((sub) => sub.category))].filter(Boolean),
    [subs]
  )

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
                />
              )
            })}
          </div>
        )}
      </div>

      {stopped.length > 0 ? (
        <div>
          <SectionLabel>止めたもの {stopped.length}件</SectionLabel>
          <div className="flex flex-col gap-2.5 opacity-60">
            {stopped.map((sub) => (
              <Row key={sub.id} sub={sub} onEdit={() => setEditing(sub)} />
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
 * 押すと編集。解約ページを入れてあるものは、右端から直接開けるようにする。
 * 止めたいと思ったときに、探すところから始めずに済む。
 */
function Row({
  sub,
  due,
  days,
  onEdit,
}: {
  sub: Subscription
  due?: string
  days?: number
  onEdit: () => void
}) {
  // 1週間を切ったら色を付ける。見直すなら落ちる前である
  const near = typeof days === 'number' && days <= 7

  return (
    <div className="glass relative overflow-hidden rounded-2xl">
      <button
        type="button"
        onClick={withTapFeedback(onEdit)}
        aria-label={`${sub.name}を編集`}
        className="flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:bg-white/[0.03]"
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
          {sub.note ? (
            <p className="mt-1 truncate text-[11px] text-fg-mute">{sub.note}</p>
          ) : null}
        </div>

        <span
          className={`tnum shrink-0 text-right text-[15px] font-semibold text-marine ${
            sub.url ? 'pr-7' : ''
          }`}
        >
          {yen(sub.amount)}
        </span>
      </button>

      {sub.url ? (
        <a
          href={sub.url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`${sub.name}の管理ページを開く`}
          title="管理・解約のページを開く"
          className="absolute top-1/2 right-2.5 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-ink/85 text-fg-mute backdrop-blur transition-colors hover:border-marine/60 hover:text-marine"
        >
          <IconExternal size={14} />
        </a>
      ) : null}
    </div>
  )
}
