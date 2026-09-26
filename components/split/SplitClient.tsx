'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Amount,
  Avatar,
  Button,
  Card,
  EmptyState,
  IconButton,
  IconFrame,
  PillTabs,
  ProgressBar,
  SectionLabel,
  Segmented,
} from '@/components/ui'
import {
  IconCamera,
  IconChevronRight,
  IconEdit,
  IconPlus,
  IconTrash,
  IconUsers,
} from '@/components/icons'
import CategoryIcon from '@/components/CategoryIcon'
import { CopyAmountButton, OpenAppButton } from '@/components/HandoffActions'
import SplitSheet from '@/components/split/SplitSheet'
import { createClient } from '@/lib/supabase/client'
import { removeReceiptFile } from '@/lib/receipt'
import { distributeEqual, simplifyDebts } from '@/lib/warikan'
import { dueYen, shortDate, yen } from '@/lib/format'
import { categoryLabel } from '@/lib/constants'
import type {
  Share,
  MarineLinkView,
  SortOrder,
  SplitFilter,
  SplitMemberView,
  SplitRecord,
} from '@/types'

/**
 * '2026-10-06' → '10/6'。
 *
 * 日付を2つ並べるときに使う。曜日まで付けると1行に収まらず、
 * その後ろの種別と立替えた人が切れてしまう。
 */
function dayOnly(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  if (!m || !d) return iso
  return `${m}/${d}`
}

function sharesOf(record: SplitRecord, fallbackNames: string[]): Share[] {
  if (record.shares && record.shares.length > 0) return record.shares
  const names = fallbackNames.slice(0, Math.max(2, record.member_count))
  const burdens = distributeEqual(record.amount, names.length)
  return names.map((m, i) => ({ member: m, value: null, burden: burdens[i] }))
}

export default function SplitClient({
  ownerId,
  records,
  members,
  links,
  openNew = false,
}: {
  records: SplitRecord[]
  members: SplitMemberView[]
  /** 接続している相手。登録したことを知らせる先を引くのに使う */
  links: MarineLinkView[]
  /**
   * 共有の割り勘の持ち主。書き込みはこの人の持ち物として行う。
   * 自分が持ち主のときは自分の id が入る。
   */
  ownerId: string
  /** ホームの「割り勘を作成」から来たか。真なら登録シートを開いて始める */
  openNew?: boolean
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<SplitFilter>('unpaid')
  const [sort, setSort] = useState<SortOrder>('desc')
  const [sheetOpen, setSheetOpen] = useState(openNew)
  const [editing, setEditing] = useState<SplitRecord | null>(null)
  const [busy, setBusy] = useState(false)

  // 開いたら ?new=1 を落としておく。残したままだと、シートを閉じたあとの
  // 再読み込みや「戻る」でまた開いてしまう。
  // history を直接書き換えるのは、router.replace だと再描画が一度挟まるため。
  useEffect(() => {
    if (openNew) window.history.replaceState(null, '', '/split')
  }, [openNew])

  const memberNames = useMemo(() => members.map((m) => m.name), [members])
  // 精算や明細では名前しか手元に無いので、名前から写真を引けるようにしておく
  const avatarOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of members) {
      if (m.avatar_url) map.set(m.name, m.avatar_url)
    }
    return (name: string) => map.get(name) ?? null
  }, [members])
  const unpaid = useMemo(() => records.filter((r) => r.status === 'unpaid'), [records])
  const paid = useMemo(() => records.filter((r) => r.status === 'paid'), [records])

  const { dueTotals, transfers, unpaidTotal, settlementTotal, balancedTotal } = useMemo(() => {
    const paidMap = new Map<string, number>(memberNames.map((m) => [m, 0]))
    const burdenMap = new Map<string, number>(memberNames.map((m) => [m, 0]))

    for (const record of unpaid) {
      paidMap.set(record.payer, (paidMap.get(record.payer) ?? 0) + record.amount)
      for (const share of sharesOf(record, memberNames)) {
        burdenMap.set(share.member, (burdenMap.get(share.member) ?? 0) + share.burden)
      }
    }

    const names = new Set([...memberNames, ...paidMap.keys(), ...burdenMap.keys()])
    const balances = [...names].map((member) => ({
      member,
      balance: (paidMap.get(member) ?? 0) - (burdenMap.get(member) ?? 0),
    }))

    // 未精算ぶんの「その人が払う金額」。負担した額から立替えた額を引く。
    // 立替えの方が多い人はマイナス（＝受け取る側）になる。
    const dueMap = new Map<string, number>(
      [...names].map((member) => [
        member,
        (burdenMap.get(member) ?? 0) - (paidMap.get(member) ?? 0),
      ])
    )

    const transfers = simplifyDebts(balances)
    // 未精算レコードの総額と、そのうち実際に動かす必要がある金額（＝精算額）を分けて持つ
    const unpaidTotal = unpaid.reduce((sum, r) => sum + r.amount, 0)
    const settlementTotal = transfers.reduce((sum, t) => sum + t.amount, 0)

    return {
      dueTotals: dueMap,
      transfers,
      unpaidTotal,
      settlementTotal,
      // 立替が釣り合っていて送金不要な分
      balancedTotal: Math.max(0, unpaidTotal - settlementTotal),
    }
  }, [unpaid, memberNames])

  /**
   * 割り勘に出すメンバー。
   *
   * 精算の計算（dueTotals / transfers）は members 全員で行う。
   * 参加を外した人の未精算が計算から消えると、払うべき額が合わなくなるため。
   * ここで絞るのは見た目と、これから登録するときの候補だけ。
   *
   * 未精算が残っている人は、外していても一覧に出す。
   * 金額が見えなくなると、精算の欄にだけ名前が出て辻褄が合わなくなる。
   */
  const listedMembers = useMemo(
    () => members.filter((m) => m.join_split || (dueTotals.get(m.name) ?? 0) !== 0),
    [members, dueTotals]
  )

  /** 登録シートに渡す顔ぶれ。編集中の記録に載っている人は、外していても残す */
  const selectableMembers = useMemo(() => {
    const onRecord = new Set((editing?.shares ?? []).map((share) => share.member))
    if (editing?.payer) onRecord.add(editing.payer)
    return members.filter((m) => m.join_split || onRecord.has(m.name))
  }, [members, editing])

  const visible = useMemo(() => {
    const base = filter === 'unpaid' ? unpaid : filter === 'paid' ? paid : records
    return [...base].sort((a, b) => {
      const diff = b.date.localeCompare(a.date)
      return sort === 'desc' ? diff : -diff
    })
  }, [records, unpaid, paid, filter, sort])

  const toggleStatus = async (record: SplitRecord) => {
    setBusy(true)
    const supabase = createClient()
    await supabase
      .from('records')
      .update({ status: record.status === 'unpaid' ? 'paid' : 'unpaid' })
      .eq('id', record.id)
    setBusy(false)
    router.refresh()
  }

  const remove = async (record: SplitRecord) => {
    if (!window.confirm(`「${record.content}」を削除しますか？`)) return
    setBusy(true)
    const supabase = createClient()
    await supabase.from('records').delete().eq('id', record.id)
    // 記録が消えたら写真も要らない。残しても誰も辿り着けず、容量だけ使う
    await removeReceiptFile(supabase, record.receipt_path)
    setBusy(false)
    router.refresh()
  }

  const settleAll = async () => {
    if (unpaid.length === 0) return
    if (!window.confirm(`未精算 ${unpaid.length} 件をすべて精算済みにしますか？`)) return
    setBusy(true)
    const supabase = createClient()
    await supabase
      .from('records')
      .update({ status: 'paid' })
      .in(
        'id',
        unpaid.map((r) => r.id)
      )
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 未精算サマリー */}
      <Card className="glow">
        <div className="flex items-start gap-3">
          <IconFrame tone="marine">
            <IconUsers size={17} />
          </IconFrame>
          <div className="min-w-0 flex-1">
            <div className="eyebrow">精算に必要な額</div>
            <div className="mt-1.5">
              <Amount value={settlementTotal} size="xl" tone="marine" />
            </div>
            <p className="mt-1 text-xs text-fg-mute">{unpaid.length}件の割り勘が未精算です</p>
          </div>
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <ProgressBar
            value={balancedTotal}
            max={unpaidTotal}
            label="支払い状況"
            caption={`残り ${yen(settlementTotal)} / ${yen(unpaidTotal)}`}
          />
        </div>
      </Card>

      {/* メンバー */}
      <div>
        <SectionLabel
          action={
            <Link
              href="/me/members"
              prefetch={false}
              className="inline-flex items-center gap-1 text-[12px] text-fg-dim hover:text-marine"
            >
              編集
              <IconChevronRight size={13} />
            </Link>
          }
        >
          メンバー
        </SectionLabel>
        <Card>
          {listedMembers.length === 0 ? (
            <p className="text-[13px] text-fg-mute">
              メンバーが未登録です。「編集」から追加してください。
            </p>
          ) : (
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
              {listedMembers.map((m) => (
                <div key={m.id} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
                  <Avatar name={m.name} src={m.avatar_url} selected={m.is_self} />
                  <span className="w-full truncate text-center text-[11px] text-fg-dim">
                    {m.is_self ? 'あなた' : m.name}
                  </span>
                  {/* その人が払う金額。受け取る側はマイナスで出す */}
                  <span
                    className={`tnum text-center text-[11px] ${
                      (dueTotals.get(m.name) ?? 0) < 0
                        ? 'text-teal'
                        : (dueTotals.get(m.name) ?? 0) > 0
                          ? 'text-fg-dim'
                          : 'text-fg-mute'
                    }`}
                  >
                    {dueYen(dueTotals.get(m.name) ?? 0)}
                  </span>
                </div>
              ))}
              <Link
                href="/me/members"
                prefetch={false}
                aria-label="メンバーを追加"
                className="flex w-16 shrink-0 flex-col items-center gap-1.5"
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-line text-fg-mute">
                  <IconPlus size={17} />
                </span>
                <span className="text-[11px] text-fg-mute">追加</span>
              </Link>
            </div>
          )}
          {listedMembers.length > 0 ? (
            <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-fg-mute">
              金額は未精算ぶんの精算額です。プラスはその人が払う金額、
              マイナスは受け取る金額を表します。
            </p>
          ) : null}
        </Card>
      </div>

      {/* 精算 */}
      <div>
        <SectionLabel>精算</SectionLabel>
        {transfers.length === 0 ? (
          <Card>
            <p className="text-center text-sm text-teal">精算は不要です</p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {transfers.map((t) => (
              <Card key={`${t.from}-${t.to}-${t.amount}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2 text-sm">
                    <Avatar name={t.from} src={avatarOf(t.from)} size={26} />
                    <span className="truncate">{t.from}</span>
                    <span className="text-fg-mute">→</span>
                    <Avatar name={t.to} src={avatarOf(t.to)} size={26} />
                    <span className="truncate">{t.to}</span>
                  </div>
                  <Amount value={t.amount} size="md" tone="marine" />
                </div>
                <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 sm:flex-row">
                  <CopyAmountButton amount={t.amount} label={`${yen(t.amount)}をコピー`} />
                  <OpenAppButton app="paypay" />
                </div>
              </Card>
            ))}
            <Button full onClick={settleAll} disabled={busy}>
              未精算をすべて精算済みにする
            </Button>
          </div>
        )}
      </div>

      {/* 支出一覧 */}
      <div>
        <SectionLabel
          action={
            <button
              type="button"
              onClick={() => {
                setEditing(null)
                setSheetOpen(true)
              }}
              className="inline-flex items-center gap-1.5 text-[12px] text-marine"
            >
              <IconPlus size={15} />
              支出を登録
            </button>
          }
        >
          支出一覧
        </SectionLabel>

        <div className="mb-3">
          <PillTabs
            value={filter}
            options={[
              { id: 'unpaid', label: `未精算 (${unpaid.length})` },
              { id: 'all', label: 'すべて' },
              { id: 'paid', label: `完了 (${paid.length})` },
            ]}
            onChange={setFilter}
          />
        </div>

        <div className="mb-3">
          <Segmented
            value={sort}
            options={[
              { id: 'desc', label: '新しい順' },
              { id: 'asc', label: '古い順' },
            ]}
            onChange={setSort}
          />
        </div>

        {visible.length === 0 ? (
          <EmptyState
            title="記録がありません"
            description="観戦チケットや飲食などの立替を登録すると、精算額が自動で計算されます。"
          />
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map((record) => (
              <Card key={record.id} className="!p-3.5">
                <div className="flex items-start gap-3">
                  <IconFrame>
                    <CategoryIcon category={record.category} />
                  </IconFrame>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {/* 何月何日分か。チケットもサウナも、払った日より行く日を
                          先に知りたいので、名前の前に出す。いままで内容の頭に
                          手で書き足していたぶんがここに来る */}
                      {record.target_date ? (
                        <span className="tnum shrink-0 rounded-md border border-marine/40 px-1.5 text-[10px] leading-[17px] text-marine">
                          {dayOnly(record.target_date)}分
                        </span>
                      ) : null}
                      <span className="truncate text-sm">{record.content}</span>
                    </div>
                    <div className="mt-1 truncate text-[11px] text-fg-mute">
                      {/* 行く日を上に出したときは、こちらが払った日だと分かるように
                          「決済」と添える。そのぶん曜日は落とす */}
                      <span className="tnum">
                        {record.target_date ? `${dayOnly(record.date)}決済` : shortDate(record.date)}
                      </span>
                      {' / '}
                      {categoryLabel(record.category)}
                      {' / '}
                      {record.payer} が立替
                    </div>
                  </div>

                  <Amount value={record.amount} size="sm" />
                </div>

                <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
                  <div className="flex min-w-0 items-center gap-1">
                    {sharesOf(record, memberNames)
                      .slice(0, 4)
                      .map((s) => (
                        <Avatar key={s.member} name={s.member} src={avatarOf(s.member)} size={22} />
                      ))}
                    {record.member_count > 4 ? (
                      <span className="text-[11px] text-fg-mute">+{record.member_count - 4}</span>
                    ) : null}

                    {/* 領収書・決済画面が付いているとき。操作の並びではなく
                        顔写真の横に置く。あるか無いかを見せるものなので */}
                    {record.receipt_url ? (
                      <a
                        href={record.receipt_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="領収書・決済画面を見る"
                        title="領収書・決済画面を見る"
                        className="ml-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-marine/40 text-marine transition-colors hover:bg-marine/10"
                      >
                        <IconCamera size={13} />
                      </a>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggleStatus(record)}
                      disabled={busy}
                      className={`h-9 rounded-lg border px-3 text-[11px] whitespace-nowrap transition-colors disabled:opacity-40 ${
                        record.status === 'unpaid'
                          ? 'border-line text-fg-mute hover:border-marine/50 hover:text-marine'
                          : 'border-teal/40 text-teal'
                      }`}
                    >
                      {record.status === 'unpaid' ? '精算する' : '完了'}
                    </button>
                    <IconButton
                      label="編集"
                      onClick={() => {
                        setEditing(record)
                        setSheetOpen(true)
                      }}
                    >
                      <IconEdit size={15} />
                    </IconButton>
                    <IconButton
                      label="削除"
                      onClick={() => remove(record)}
                      className="hover:border-danger/50 hover:text-danger"
                    >
                      <IconTrash size={15} />
                    </IconButton>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {sheetOpen ? (
        <SplitSheet
          record={editing}
          members={selectableMembers}
          links={links}
          userId={ownerId}
          onClose={() => {
            setSheetOpen(false)
            setEditing(null)
          }}
        />
      ) : null}
    </div>
  )
}
