'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import SubSheet from '@/components/subs/SubSheet'
import {
  IconBook,
  IconBriefcase,
  IconDots,
  IconExternal,
  IconGame,
  IconHome,
  IconMedical,
  IconMusic,
  IconPlay,
  IconPlus,
  IconShield,
  IconSignal,
  IconSpark,
} from '@/components/icons'
import { Card, EmptyState, SectionLabel } from '@/components/ui'
import { yen } from '@/lib/format'
import { withTapFeedback } from '@/lib/haptics'
import { createClient } from '@/lib/supabase/client'
import {
  DEFAULT_SUB_SORT,
  SHARE_COLORS,
  SHARE_REST,
  SUB_SORTS,
  byCategory,
  dayText,
  daysUntil,
  intervalLabel,
  monthlyCost,
  nextPayment,
  sortSubs,
  toSubSort,
  topShares,
  totals,
  type SubSort,
} from '@/lib/subscriptions'
import type { Subscription } from '@/types'

/** 並べ方を覚えておく場所。端末ごとで、他の人には移らない */
const SORT_KEY = 'marine-wallet:subs-sort'

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
  /**
   * 並べ方。選んだものは次に開いたときにも残す。
   *
   * 最初の描画はサーバーと揃える必要があるので、既定で描いてから読み直す。
   * localStorage をそのまま初期値にすると、サーバーの描画と食い違う。
   */
  const [sort, setSort] = useState<SubSort>(DEFAULT_SUB_SORT)
  useEffect(() => {
    try {
      setSort(toSubSort(localStorage.getItem(SORT_KEY)))
    } catch {
      // 読めなくても既定で動く
    }
  }, [])

  const pickSort = (next: SubSort) => {
    setSort(next)
    try {
      localStorage.setItem(SORT_KEY, next)
    } catch {
      // 覚えられなくても並べ替えはできる
    }
  }

  const ordered = useMemo(() => sortSubs(living, today, sort), [living, today, sort])
  const sum = useMemo(() => totals(rows), [rows])
  const shares = useMemo(() => topShares(byCategory(rows)), [rows])

  /**
   * ジャンルごとの色。上の帯と札で同じ色を使う。
   *
   * 色が一致していれば、札を見たときに「これは帯のどの部分か」がすぐ分かる。
   * まとめた先（ほか）に入るものは、最後の色で揃える。
   */
  const tint = useMemo(() => {
    const map = new Map<string, string>()
    shares.forEach((share, index) => {
      if (share.category !== SHARE_REST) map.set(share.category, SHARE_COLORS[index % SHARE_COLORS.length])
    })
    return map
  }, [shares])

  const categories = useMemo(
    () => [...new Set(subs.map((sub) => sub.category))].filter(Boolean),
    [subs]
  )

  /**
   * すでに使っている支払い方法と、それぞれ何件で使っているか。
   * 同じカードを何度も書かずに済み、消すときに何に効くかも分かる
   */
  const methods = useMemo(() => {
    const counts = new Map<string, number>()
    for (const sub of subs) {
      if (!sub.method) continue
      counts.set(sub.method, (counts.get(sub.method) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'))
  }, [subs])

  /**
   * 支払い方法を候補から消す。
   *
   * 候補は使っている行から作っているので、使っている行から外すしかない。
   * サブスクそのものは消さない。払い方を変えただけ、ということもある。
   */
  const removeMethod = async (name: string) => {
    const supabase = createClient()
    const { error: failed } = await supabase
      .from('subscriptions')
      .update({ method: '' })
      .eq('user_id', userId)
      .eq('method', name)

    if (failed) return false
    router.refresh()
    return true
  }

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
              <span className="tnum block text-[30px] leading-none font-semibold text-marine">
                {yen(sum.monthly)}
              </span>
              <span className="mt-1.5 block text-[10px] text-fg-mute">
                {sum.count}件・周期で割った額
              </span>
            </div>
            <div className="shrink-0 text-right">
              <span className="block text-[11px] text-fg-mute">1年で</span>
              <span className="tnum block text-[15px] font-semibold">{yen(sum.yearly)}</span>
            </div>
          </div>

          {/* ジャンルごとの内訳。何に効いているかが分かる */}
          {shares.length > 0 ? (
            <div className="mt-3.5 border-t border-line-soft pt-3">
              {/* 細い帯だと、1割に満たないものが線にもならない。
                  少しだけ太くして、最小の幅も決めておく */}
              <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
                {shares.map((share, index) => (
                  <span
                    key={share.category}
                    className="min-w-[4px] first:rounded-l-full last:rounded-r-full"
                    style={{
                      width: `${share.percent}%`,
                      backgroundColor: SHARE_COLORS[index % SHARE_COLORS.length],
                    }}
                  />
                ))}
              </div>

              {/* 色と名前を結ぶ印を付ける。付けないと、帯のどれがどれか分からない */}
              <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1.5">
                {shares.map((share, index) => (
                  <span
                    key={share.category}
                    className="inline-flex items-center gap-1.5 text-[11px] text-fg-dim"
                  >
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: SHARE_COLORS[index % SHARE_COLORS.length] }}
                    />
                    {share.category}
                    <span className="tnum text-fg">{yen(share.monthly)}</span>
                    <span className="tnum text-fg-mute">{share.percent}%</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </Card>
      </div>

      {error ? <p className="text-[12px] text-danger">{error}</p> : null}

      <div>
        <SectionLabel
          action={
            living.length > 1 ? (
              <div className="flex shrink-0 items-center gap-1 rounded-full border border-line p-0.5">
                {SUB_SORTS.map((item) => {
                  const on = item.id === sort
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={on}
                      onClick={withTapFeedback(() => pickSort(item.id))}
                      className={`h-6 rounded-full px-2 text-[11px] transition-colors ${
                        on ? 'bg-marine font-medium text-ink' : 'text-fg-mute hover:text-marine'
                      }`}
                    >
                      {item.label}
                    </button>
                  )
                })}
              </div>
            ) : null
          }
        >
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
                  tint={tint.get(sub.category)}
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
                tint={tint.get(sub.category)}
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
          onRemoveMethod={removeMethod}
          today={today}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </div>
  )
}

/**
 * ジャンルの絵。札の左端に出して、何のための支払いかを文字より先に伝える。
 *
 * 自分で書いたジャンルには当てる絵が無いので、点3つにする。無理に
 * それらしい絵を当てると、別のものだと思わせる。
 */
const CATEGORY_ICONS: Record<string, typeof IconDots> = {
  動画: IconPlay,
  音楽: IconMusic,
  読書: IconBook,
  ゲーム: IconGame,
  仕事: IconBriefcase,
  生活: IconHome,
  美容: IconSpark,
  治療: IconMedical,
  保険: IconShield,
  通信: IconSignal,
}

/**
 * 1件ぶんの札。
 *
 * 縦の線を揃える。左は名前とその素性、右は決まった幅の箱にして、金額を
 * 上、スイッチを下に置く。金額の右端が札ごとにずれていると、いくら
 * 出ていくのかを上から下へ目で追えない。
 *
 * どれも必ず2行にする。メモの有る無しで高さが変わると、並べたときに
 * 段が揃わない。メモは開けば読める。
 *
 * 2行目の頭はジャンル。何のための支払いかが先に目に入るようにする。
 * 印の色は上の帯と同じにしてあるので、札と内訳を見た目で結べる。
 *
 * 押すと編集。解約ページを入れてあるものはスイッチの隣から直接開ける。
 * アプリで止めても請求は止まらないので、本当に解約するにはそちらへ行く。
 */
function Row({
  sub,
  due,
  days,
  tint,
  onEdit,
  onToggle,
}: {
  sub: Subscription
  due?: string
  days?: number
  /** ジャンルの色。上の帯と合わせる */
  tint?: string
  onEdit: () => void
  onToggle: () => void
}) {
  // 1週間を切ったら色を付ける。見直すなら落ちる前である
  const near = typeof days === 'number' && days <= 7

  const Glyph = CATEGORY_ICONS[sub.category] ?? IconDots
  const color = tint ?? 'var(--color-fg-mute)'

  return (
    <div className="glass flex items-center gap-2.5 overflow-hidden rounded-2xl py-3 pr-3 pl-3">
      {/* ジャンルの絵。色は上の帯と同じにして、札と内訳を結べるようにする */}
      <span
        aria-hidden="true"
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
          sub.active ? '' : 'opacity-55'
        }`}
        style={{
          color,
          borderColor: tint ? `${tint}55` : 'var(--color-line)',
          backgroundColor: tint ? `${tint}14` : 'rgba(255,255,255,0.03)',
        }}
      >
        <Glyph size={17} />
      </span>

      <button
        type="button"
        onClick={withTapFeedback(onEdit)}
        aria-label={`${sub.name}を編集`}
        className={`min-w-0 flex-1 text-left ${sub.active ? '' : 'opacity-55'}`}
      >
        <div className="flex min-w-0 items-baseline gap-2 overflow-hidden whitespace-nowrap">
          {/* サービス名を先に出し切る。縮むのはプラン名のほうだけにする。
              どちらも縮めると「家賃＆…」のようにサービス名が読めなくなり、
              どのサービスの話か分からなくなる。
              名前は縮まない（shrink-0）が、1行を越えるときは max-w-full で
              止めて三点リーダーにする。プラン名は余りを受け取る（basis-0）
              ので、名前が長い日は0まで引き下がる */}
          <span className="max-w-full min-w-0 shrink-0 truncate text-[14px] font-semibold">
            {sub.name}
          </span>
          {sub.plan ? (
            <span className="min-w-0 flex-1 basis-0 truncate text-[11px] text-fg-dim">
              {sub.plan}
            </span>
          ) : null}
        </div>

        {/* 折り返さない。1件が3行になると、その札だけ背が高くなる */}
        <div className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] whitespace-nowrap text-fg-mute">
          <span className="shrink-0 text-fg-dim">{sub.category}</span>
          <span className="shrink-0 text-line">|</span>
          <span className="shrink-0">{intervalLabel(sub.interval_months)}</span>
          {/* 毎月でないものは月あたりも添える。合計も金額順も月あたりで
              出しているので、これが無いと年払いの並びが外れて見える */}
          {sub.interval_months > 1 ? (
            <span className="tnum shrink-0">月{yen(monthlyCost(sub))}</span>
          ) : null}
          {due ? (
            <span className={`tnum shrink-0 ${near ? 'text-warn' : ''}`}>{dayText(due)}</span>
          ) : null}
          {sub.method ? <span className="min-w-0 truncate">{sub.method}</span> : null}
        </div>
      </button>

      {/* 右は決まった幅。札がどれでも金額の右端とスイッチの位置が揃う */}
      <div className="flex w-[84px] shrink-0 flex-col items-end gap-1.5">
        <span
          className={`tnum text-[15px] leading-none font-semibold ${
            sub.active ? 'text-marine' : 'text-fg-mute'
          }`}
        >
          {yen(sub.amount)}
        </span>

        <div className="flex items-center gap-1.5">
          {sub.url ? (
            <a
              href={sub.url}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`${sub.name}の管理ページを開く`}
              title="管理・解約のページを開く"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-line text-fg-mute transition-colors hover:border-marine/60 hover:text-marine"
            >
              <IconExternal size={12} />
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
    </div>
  )
}
