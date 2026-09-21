'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Amount,
  Button,
  Card,
  EmptyState,
  IconButton,
  IconFrame,
  PillTabs,
  ProgressBar,
  Row,
  SectionLabel,
  Segmented,
  StatusPill,
} from '@/components/ui'
import {
  IconBaseball,
  IconChevronRight,
  IconEdit,
  IconRules,
  IconSpark,
  IconTicket,
  IconTrash,
  IconUsers,
} from '@/components/icons'
import { CopyAmountButton, OpenAppButton } from '@/components/HandoffActions'
import GameSheet from '@/components/savings/GameSheet'
import CompanionSheet from '@/components/savings/CompanionSheet'
import CustomSavingSheet from '@/components/savings/CustomSavingSheet'
import { createClient } from '@/lib/supabase/client'
import { BREAKDOWN_GROUP_LABEL, calcSaving, groupBreakdown } from '@/lib/savings'
import { companionLabel, visitFromGame, visitOfGame } from '@/lib/stadium-stamp'
import { stadiumOf } from '@/lib/stadiums'
import { tapFeedback } from '@/lib/haptics'
import { depositedTotal, notDepositedTotal } from '@/lib/insights'
import { notifyMonthConfirmed } from '@/lib/notify-client'
import { currentMonth, monthLabel, monthLabelEn, shortDate, yen } from '@/lib/format'
import { cancelledOf, mergeCancelled, upcomingOf } from '@/lib/upcoming'
import {
  MONTHLY_STATUS_LABEL,
  homeAwayLabel,
  opponentLabel,
  phaseLabel,
  pitchingHighlightLabel,
  resultLabel,
} from '@/lib/constants'
import type {
  CircleMember,
  GamePlan,
  MonthlySaving,
  ScheduledGame,
  MonthlyStatus,
  Game,
  StadiumVisit,
  SavingEntryRow,
  SavingCustomPreset,
  SavingRules,
  SharedGoalView,
} from '@/types'

const STATUS_TONE: Record<MonthlyStatus, 'neutral' | 'marine' | 'warn' | 'done'> = {
  calculating: 'neutral',
  ready: 'marine',
  deposited: 'done',
}

type SheetMode = 'game' | 'custom'

export default function SavingsClient({
  userId,
  entries,
  monthlySavings,
  rules,
  presets,
  goals,
  isMaster,
  games,
  visits,
  members,
  cancelled,
  scheduled,
  plans,
}: {
  userId: string
  entries: SavingEntryRow[]
  monthlySavings: MonthlySaving[]
  rules: SavingRules
  /** カスタム登録の定型。貯金ルールの画面で増やせる */
  presets: SavingCustomPreset[]
  /** 共同貯金（仕様書17章はロッテ貯金内の機能と定めている） */
  goals: SharedGoalView[]
  /** マスター権限。確定が共有先にも反映される */
  isMaster: boolean
  /** 共通の試合データ。まだ自分が積み立てていないものを拾う */
  games: Game[]
  /** 現地観戦の記録。球場スタンプ帳（/stadiums）と同じもの */
  visits: StadiumVisit[]
  /** 貯金を共にしている人。一緒に行った人を選ぶのに使う */
  members: CircleMember[]
  /** 中止になった試合。記録一覧に混ぜて出す */
  cancelled: ScheduledGame[]
  /** これからの試合。中止もそのまま入る */
  scheduled: ScheduledGame[]
  /** 観戦予定。自分のぶんと、接続している相手のぶん */
  plans: GamePlan[]
}) {
  const router = useRouter()
  const [sheetMode, setSheetMode] = useState<SheetMode | null>(null)
  const [editing, setEditing] = useState<SavingEntryRow | null>(null)
  const [addMode, setAddMode] = useState<SheetMode>('game')
  const [busy, setBusy] = useState(false)
  // 取りこぼした試合の取り込み。押した直後だけ結果を出す
  const [backfilling, setBackfilling] = useState(false)
  const [backfillNote, setBackfillNote] = useState<string | null>(null)

  // 記録達成の取り込み
  const [fetchingMilestones, setFetchingMilestones] = useState(false)
  const [milestoneNote, setMilestoneNote] = useState<string | null>(null)

  // 現地観戦を押したときのエラー
  const [attendError, setAttendError] = useState<string | null>(null)

  // 一緒に行った人を選ぶシート。開いている来場記録と、その試合
  const [companionOf, setCompanionOf] = useState<{ visit: StadiumVisit; game: Game } | null>(null)

  // 確定が何人に反映されたか。押した直後だけ出す
  const [sharedCount, setSharedCount] = useState<number | null>(null)
  const [monthError, setMonthError] = useState<string | null>(null)

  const months = useMemo(() => {
    // 共通の試合ぶんも候補に入れる。自分の記録がまだ無い月にも移動できるようにする
    const set = new Set<string>(entries.map((e) => e.month))
    for (const g of games) set.add(g.game_date.slice(0, 7))
    set.add(currentMonth())
    return [...set].sort((a, b) => b.localeCompare(a))
  }, [entries, games])

  const [month, setMonth] = useState(() => months[0] ?? currentMonth())

  // 累計は「ワンバンクへ入金した月」だけを数える（ホーム・履歴と同じ定義）
  const total = useMemo(() => depositedTotal(monthlySavings), [monthlySavings])
  const notDeposited = useMemo(
    () => notDepositedTotal(entries, monthlySavings),
    [entries, monthlySavings]
  )

  const monthEntries = useMemo(
    () =>
      entries
        .filter((e) => e.month === month)
        .sort((a, b) => b.entry_date.localeCompare(a.entry_date)),
    [entries, month]
  )

  /**
   * 記録一覧に出す並び。中止になった試合を日付の位置に挟む。
   *
   * 中止の日は貯金が入らない。記録だけを並べると、その日は何も無かったのか
   * 入れ忘れたのかが分からない。
   */
  /** これからの試合。月の選択とは関係なく、常に直近の5件を出す */
  const next = useMemo(() => upcomingOf(scheduled), [scheduled])

  /** 日付ごとの観戦予定。自分のぶんと、相手のぶんを分けて持つ */
  const planOf = useMemo(() => {
    const map = new Map<string, { mine: boolean; others: string[] }>()
    for (const plan of plans) {
      const row = map.get(plan.game_date) ?? { mine: false, others: [] }
      if (plan.user_id === userId) row.mine = true
      else {
        const name = members.find((m) => m.id === plan.user_id)?.member_name
        if (name) row.others.push(name)
      }
      map.set(plan.game_date, row)
    }
    return map
  }, [plans, members, userId])

  /**
   * 観戦予定を付け外しする。
   *
   * 予定は人ごとに持つ。押した人のぶんだけを書き、相手のぶんには触らない。
   * 同じ日を二度付けないよう、DB 側でも重複を止めてある（0048）。
   */
  const togglePlan = async (date: string, on: boolean) => {
    tapFeedback()
    setBusy(true)
    setAttendError(null)

    const supabase = createClient()
    const { error: saveError } = on
      ? await supabase.from('game_plans').delete().eq('user_id', userId).eq('game_date', date)
      : await supabase.from('game_plans').insert({ user_id: userId, game_date: date })

    setBusy(false)
    if (saveError) {
      setAttendError('観戦予定を記録できませんでした')
      return
    }
    router.refresh()
  }

  const records = useMemo(
    () => mergeCancelled(monthEntries, cancelledOf(cancelled, month)),
    [monthEntries, cancelled, month]
  )

  const monthTotal = useMemo(
    () => monthEntries.reduce((sum, e) => sum + e.amount, 0),
    [monthEntries]
  )

  /**
   * この月の「まだ自分が積み立てていない試合」。
   *
   * 試合データは全ユーザー共通で、貯金ルールは個人（仕様書15章）。
   * これまでは自分で試合を登録したときにしか積立が立たず、
   * 他の人が登録した試合は共通データにあるのに自分の貯金には入らなかった。
   * ここから自分のルールで積み立てられるようにする。
   */
  const registeredGameIds = useMemo(
    () => new Set(entries.map((e) => e.game_id).filter(Boolean) as string[]),
    [entries]
  )
  const monthUnregistered = useMemo(
    () =>
      games
        .filter((g) => g.game_date.startsWith(`${month}-`) && !registeredGameIds.has(g.id))
        .sort((a, b) => b.game_date.localeCompare(a.game_date)),
    [games, month, registeredGameIds]
  )
  const unregisteredTotal = useMemo(
    () => monthUnregistered.reduce((sum, g) => sum + calcSaving(g, rules).amount, 0),
    [monthUnregistered, rules]
  )

  const groups = useMemo(() => {
    const totals: Record<string, number> = { result: 0, batting: 0, pitching: 0, other: 0 }
    for (const entry of monthEntries) {
      const grouped = groupBreakdown(entry.breakdown ?? [])
      for (const key of Object.keys(totals)) totals[key] += grouped[key] ?? 0
    }
    return totals
  }, [monthEntries])

  const monthly = monthlySavings.find((m) => m.month === month) ?? null
  const status: MonthlyStatus = monthly?.status ?? 'calculating'
  const confirmed = monthly?.confirmed_amount ?? null
  const displayAmount = status === 'calculating' || confirmed === null ? monthTotal : confirmed

  /**
   * まだ貯金に入っていない試合をまとめて取り込む。
   *
   * 毎朝の取り込みは前日の1試合だけを見るので、仕組みを作る前に終わった
   * 試合や、取り込みに失敗した試合は残る。それを拾うための手動の操作。
   * npb.jp へ出られるのはサーバーだけなので、取得はサーバーで行う。
   */
  const backfill = async () => {
    setBackfilling(true)
    setBackfillNote(null)
    try {
      const res = await fetch('/api/games/backfill', { method: 'POST' })
      const body = (await res.json()) as {
        error?: string
        schedule?: { updated?: { game_date: string; status: string }[]; added?: number }
        created?: number
        skipped?: number
        remaining?: number
        collected?: { saved?: number; remaining?: number }
        boxes?: { saved?: number; remaining?: number }
        repaired?: { updated?: number; mismatches?: { game_date: string }[] }
      }
      if (!res.ok) {
        setBackfillNote(body.error ?? '取り込めませんでした')
      } else {
        const parts: string[] = []

        // 中止や時刻の変更は押した目的そのものなので、先に出す
        const schedule = body.schedule?.updated ?? []
        const cancelled = schedule.filter((g) => g.status === 'cancelled').length
        if (cancelled > 0) parts.push(`${cancelled} 試合が中止になっていました`)
        if (schedule.length - cancelled > 0) {
          parts.push(`${schedule.length - cancelled} 試合の日程を直しました`)
        }
        if ((body.schedule?.added ?? 0) > 0) {
          parts.push(`${body.schedule?.added} 試合の予定を取り込みました`)
        }

        const updated = body.repaired?.updated ?? 0
        if (updated > 0) parts.push(`${updated} 試合の内容を直しました`)

        const created = body.created ?? 0
        if (created > 0) parts.push(`${created} 試合を取り込みました`)

        const skipped = body.skipped ?? 0
        if (skipped > 0) parts.push(`見送り ${skipped}`)

        // 月ぶんの日程がまだ残っていれば、もう一度押せばよいと分かるようにする
        const restMonths = body.collected?.remaining ?? 0
        if (restMonths > 0) parts.push(`未取得の月が ${restMonths} か月`)

        const restBoxes = body.boxes?.remaining ?? 0
        if (restBoxes > 0) parts.push(`ボックススコア未取得が ${restBoxes} 試合`)

        const restGames = body.remaining ?? 0
        if (restGames > 0) parts.push(`未登録の試合が ${restGames} 件`)

        const mismatches = body.repaired?.mismatches ?? []
        if (mismatches.length > 0) {
          // 勝敗・本塁打・セーブは金額そのものなので、こちらでは直さない
          parts.push(`npb.jp と食い違う項目が ${mismatches.length} 件（直していません）`)
        }

        setBackfillNote(parts.length > 0 ? parts.join(' / ') : '直すところはありませんでした')
      }
    } catch {
      setBackfillNote('取り込めませんでした')
    }
    setBackfilling(false)
    router.refresh()
  }

  /**
   * 記録達成を取り込む。
   *
   * ページを取り直してから読み取り、達成していれば積立まで作る。
   * 毎朝の取り込みでも同じことをしている。仕込んだ直後や npb.jp の作りが
   * 変わったときに、翌朝を待たずに動かすための操作。
   *
   * 何度押しても積立は積み上がらない。同じ記録は一度しか入らない。
   */
  const fetchMilestones = async () => {
    setFetchingMilestones(true)
    setMilestoneNote(null)
    try {
      const res = await fetch('/api/npb/milestones', { method: 'POST' })
      const body = (await res.json()) as {
        error?: string
        created?: number
        known?: number
        titles?: string[]
      }
      if (!res.ok) {
        setMilestoneNote(body.error ?? '取り込めませんでした')
      } else if ((body.created ?? 0) === 0) {
        setMilestoneNote(`新しい記録はありませんでした（確認済み ${body.known ?? 0} 件）`)
      } else {
        setMilestoneNote(`${body.created} 件を貯金に追加しました: ${(body.titles ?? []).join(' / ')}`)
      }
    } catch {
      setMilestoneNote('取り込めませんでした')
    }
    setFetchingMilestones(false)
    router.refresh()
  }

  /**
   * 月末の確定と取り消し。
   *
   * 確定は「一緒に貯めている人の分もまとめて締める」操作なので、
   * 自分の行を直接書かずに RPC を通す。相手の行に書き込むのは
   * RLS では通らないため、confirm_month_for_circle（SECURITY DEFINER）が
   * 貯金に参加している接続済みメンバーだけに限って書く。
   * 入金済みは各自の財布の話なので、従来どおり自分の行だけを更新する。
   */
  const confirmMonth = async (confirm: boolean) => {
    setBusy(true)
    setMonthError(null)
    const supabase = createClient()
    const { data, error } = await supabase.rpc('confirm_month_for_circle', {
      p_month: month,
      p_confirm: confirm,
    })
    setBusy(false)
    if (error) {
      setMonthError(error.message)
      return
    }
    setSharedCount(typeof data === 'number' ? data : 0)
    // 確定した人たちへ入金のお願いを送る。取り消しでは送らない
    if (confirm) notifyMonthConfirmed(month)
    router.refresh()
  }

  /**
   * 共通の試合から、自分のルールで積立を作る。
   * 試合そのものは触らない（共通データなので、金額だけが個人のもの）。
   */
  const registerGames = async (targets: Game[]) => {
    if (targets.length === 0) return
    setBusy(true)
    setMonthError(null)
    const supabase = createClient()
    const rows = targets.map((game) => {
      // その他ボーナスは試合に付いている。自分のルールで計算した額に上乗せする
      const calc = calcSaving(game, rules, game.other_amount)
      return {
        user_id: userId,
        game_id: game.id,
        kind: 'game' as const,
        title: '',
        entry_date: game.game_date,
        amount: calc.amount,
        breakdown: calc.lines,
        other_amount: game.other_amount,
        other_note: game.other_note,
      }
    })
    const { error } = await supabase
      .from('saving_entries')
      .upsert(rows, { onConflict: 'user_id,game_id' })
    setBusy(false)
    if (error) {
      setMonthError('積立の登録に失敗しました')
      return
    }
    router.refresh()
  }

  /**
   * 現地観戦の記録。押すと球場スタンプ帳（/stadiums）にスタンプが付き、
   * もう一度押すと外れる。金額には一切効かない。貯金は試合の結果だけで
   * 決まるもので、球場へ行ったかどうかは本人しか知らない別の事実なので、
   * 試合データではなく自分の訪問記録（0038）に書く。
   */
  const toggleAttendance = async (game: Game) => {
    const place = visitFromGame(game)
    if (!place) {
      setAttendError('この試合の球場はスタンプ帳にありません')
      return
    }

    tapFeedback()
    setBusy(true)
    setAttendError(null)

    const supabase = createClient()
    const recorded = visitOfGame(game.id, visits)
    const { error } = recorded
      ? await supabase.from('stadium_visits').delete().eq('id', recorded.id)
      : await supabase.from('stadium_visits').insert({
          user_id: userId,
          stadium_id: place.stadium_id,
          visited_on: place.visited_on,
          game_id: game.id,
        })

    setBusy(false)
    if (error) {
      setAttendError('現地観戦を記録できませんでした')
      return
    }
    router.refresh()
  }

  const updateMonthly = async (patch: Partial<MonthlySaving>) => {
    setBusy(true)
    const supabase = createClient()
    await supabase
      .from('monthly_savings')
      .upsert({ user_id: userId, month, ...patch }, { onConflict: 'user_id,month' })
    setBusy(false)
    router.refresh()
  }

  const removeEntry = async (entry: SavingEntryRow) => {
    // カスタム登録は全員で共有している。自分の行を消すと全員から消える
    const scope =
      entry.kind === 'custom' ? '（一緒に貯めているメンバー全員から消えます）' : ''
    if (!window.confirm(`${shortDate(entry.entry_date)} の記録を削除しますか？${scope}`)) return
    setBusy(true)
    const supabase = createClient()
    await supabase.from('saving_entries').delete().eq('id', entry.id)
    setBusy(false)
    router.refresh()
  }

  const openAdd = () => {
    setEditing(null)
    setSheetMode(addMode)
  }

  const closeSheet = () => {
    setSheetMode(null)
    setEditing(null)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 累計 */}
      <Card className="glow">
        <div className="eyebrow">Total lotte savings</div>
        <div className="mt-2">
          <Amount value={total} size="xl" tone="marine" />
        </div>
        <p className="mt-2 text-xs text-fg-mute">
          ワンバンクへ入金した金額の合計
          {notDeposited > 0 ? ` / 未入金 ${yen(notDeposited)}` : ''}
        </p>
      </Card>

      {/* 共同貯金（仕様書17章 / 設定は Marine Link 側で行う） */}
      {goals.length > 0 ? (
        <div>
          <SectionLabel
            action={
              <Link
                href="/me/link"
                prefetch={false}
                className="text-[12px] text-fg-dim hover:text-marine"
              >
                設定
              </Link>
            }
          >
            共同貯金
          </SectionLabel>
          <div className="flex flex-col gap-2">
            {goals.map((goal) => (
              <Card key={goal.id}>
                <div className="mb-3 truncate text-sm font-medium">{goal.title}</div>
                <ProgressBar
                  value={goal.confirmed_total}
                  max={goal.target_amount}
                  label={`${goal.progress.length}人で達成`}
                  caption={`${yen(goal.confirmed_total)} / ${yen(goal.target_amount)}`}
                />
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {/* 貯金する */}
      <div>
        <SectionLabel
          action={
            <Link
              href="/savings/rules"
              prefetch={false}
              className="inline-flex items-center gap-1.5 text-[12px] text-fg-dim hover:text-marine"
            >
              <IconRules size={15} />
              貯金ルール
              <IconChevronRight size={13} />
            </Link>
          }
        >
          貯金する
        </SectionLabel>
        <Card>
          <Segmented
            value={addMode}
            options={[
              { id: 'game', label: '自動登録' },
              { id: 'custom', label: 'カスタム登録' },
            ]}
            onChange={(v) => setAddMode(v as SheetMode)}
          />
          <Button variant="primary" full className="mt-3" onClick={openAdd}>
            {addMode === 'game' ? '試合を登録する' : 'カスタム登録を追加する'}
            <IconChevronRight size={16} />
          </Button>

          {/* 取りこぼしの拾い直し。試合は全員で共有するのでマスターだけが押せる */}
          {addMode === 'game' && isMaster ? (
            <div className="mt-3 border-t border-line pt-3">
              <button
                type="button"
                onClick={backfill}
                disabled={backfilling}
                className="text-[11px] text-fg-mute underline underline-offset-2 transition-colors hover:text-marine disabled:opacity-40"
              >
                {backfilling ? '取り込んでいます' : '未登録の試合をまとめて取り込む'}
              </button>
              {backfillNote ? (
                <p className="mt-2 text-[12px] text-teal">{backfillNote}</p>
              ) : null}

              <button
                type="button"
                onClick={fetchMilestones}
                disabled={fetchingMilestones}
                className="mt-3 block text-[11px] text-fg-mute underline underline-offset-2 transition-colors hover:text-marine disabled:opacity-40"
              >
                {fetchingMilestones ? '取り込んでいます' : '記録達成を取り込む'}
              </button>
              {milestoneNote ? (
                <p className="mt-2 text-[12px] text-teal">{milestoneNote}</p>
              ) : null}
            </div>
          ) : null}
        </Card>
      </div>

      {/* 月選択 */}
      <div>
        <SectionLabel>Monthly</SectionLabel>

        <div className="mb-3">
          <PillTabs
            value={month}
            options={months.map((m) => ({ id: m, label: monthLabel(m) }))}
            onChange={setMonth}
          />
        </div>

        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="eyebrow">{monthLabelEn(month)}</div>
              <div className="mt-2">
                <Amount value={displayAmount} size="lg" tone="marine" />
              </div>
              <p className="mt-1 text-xs text-fg-mute">
                {monthEntries.length} 件
                {status !== 'calculating' && confirmed !== null && confirmed !== monthTotal
                  ? ` / 集計値 ${yen(monthTotal)}`
                  : ''}
              </p>
            </div>
            <StatusPill tone={STATUS_TONE[status]}>{MONTHLY_STATUS_LABEL[status]}</StatusPill>
          </div>

          {monthEntries.length > 0 ? (
            <div className="mt-4 divide-hairline border-t border-line pt-1">
              {Object.entries(groups)
                .filter(([, value]) => value > 0)
                .map(([key, value]) => (
                  <Row key={key} label={BREAKDOWN_GROUP_LABEL[key]} value={yen(value)} />
                ))}
            </div>
          ) : null}

          <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
            {status === 'calculating' ? (
              <>
                <Button
                  variant="primary"
                  full
                  disabled={busy || monthTotal <= 0}
                  onClick={() => confirmMonth(true)}
                >
                  この月の金額を確定する
                </Button>
                {isMaster ? (
                  <p className="text-[11px] leading-relaxed text-fg-mute">
                    確定すると、貯金に参加している接続済みメンバーの同じ月も確定します。
                    入金は各自で行うため、入金済みは相手には反映しません。
                  </p>
                ) : null}
              </>
            ) : null}

            {status === 'ready' ? (
              <>
                <p className="text-xs leading-relaxed text-fg-mute">
                  ワンバンクへの入金はご自身で行ってください。Marine Wallet
                  は金額の記録と誘導のみを行い、資金は保有・移動しません。
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <CopyAmountButton amount={displayAmount} label={`${yen(displayAmount)}をコピー`} />
                  <OpenAppButton app="onebank" />
                </div>
                <Button
                  variant="primary"
                  full
                  disabled={busy}
                  onClick={() =>
                    updateMonthly({ status: 'deposited', deposited_at: new Date().toISOString() })
                  }
                >
                  入金済みにする
                </Button>
                <Button variant="ghost" full disabled={busy} onClick={() => confirmMonth(false)}>
                  確定を取り消す
                </Button>
              </>
            ) : null}

            {sharedCount !== null && sharedCount > 0 ? (
              <p className="text-[11px] text-teal">
                貯金に参加している接続済みメンバー {sharedCount} 人の同じ月も確定しました。
              </p>
            ) : null}
            {monthError ? <p className="text-[13px] text-danger">{monthError}</p> : null}

            {status === 'deposited' ? (
              <>
                <p className="text-xs text-fg-mute">
                  {monthly?.deposited_at
                    ? `${new Date(monthly.deposited_at).toLocaleDateString('ja-JP')} に入金済み`
                    : '入金済み'}
                </p>
                <Button
                  variant="ghost"
                  full
                  disabled={busy}
                  onClick={() => updateMonthly({ status: 'ready', deposited_at: null })}
                >
                  入金済みを取り消す
                </Button>
              </>
            ) : null}
          </div>
        </Card>
      </div>

      {/* これからの試合。中止もここに出る */}
      <div>
        <SectionLabel>Schedule</SectionLabel>

        <Card>
          <div className="eyebrow">これからの試合</div>

          {next.length === 0 ? (
            <p className="mt-3 text-[13px] leading-relaxed text-fg-mute">
              予定がまだありません。日程は毎朝取り込んでいます。
            </p>
          ) : (
            <div className="divide-hairline mt-1.5">
              {next.map((game) => {
                const plan = planOf.get(game.date) ?? { mine: false, others: [] }

                return (
                  <div
                    key={`${game.date}-${game.opponent}-${game.startTime}`}
                    className={`py-2 ${game.cancelled ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="tnum shrink-0 text-[11px] text-fg-mute">
                        {shortDate(game.date)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        <span className="text-fg-mute">{game.isHome ? 'vs' : '@'}</span>{' '}
                        {game.opponent}
                        {game.place ? (
                          <span className="text-[11px] text-fg-mute"> / {game.place}</span>
                        ) : null}
                      </span>
                      {game.cancelled ? (
                        <span className="shrink-0 rounded-full border border-danger/50 px-2 py-0.5 text-[10px] text-danger">
                          {game.note}
                        </span>
                      ) : (
                        <>
                          <span className="tnum shrink-0 text-[11px] text-marine">
                            {game.startTime}
                          </span>
                          {/* 観戦予定。記録一覧の「現地観戦」と同じボタンにする。
                              中止の試合には出さない（行く先が無い） */}
                          <IconButton
                            label={plan.mine ? '観戦予定（取り消す）' : '観戦予定'}
                            aria-pressed={plan.mine}
                            disabled={busy}
                            onClick={() => togglePlan(game.date, plan.mine)}
                            className={
                              plan.mine ? '!border-marine/60 bg-marine/12 !text-marine' : ''
                            }
                          >
                            <IconTicket size={15} />
                          </IconButton>
                        </>
                      )}
                    </div>

                    {/* 相手も行くなら名前を出す。待ち合わせの相談になる */}
                    {!game.cancelled && plan.others.length > 0 ? (
                      <div className="mt-1 truncate text-[11px] text-marine">
                        {plan.others.join('・')}も予定
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {/* 記録一覧 */}
      <div>
        <SectionLabel>Records</SectionLabel>

        {attendError ? (
          <p className="mb-2 text-[13px] text-danger">{attendError}</p>
        ) : null}

        {records.length === 0 ? (
          <EmptyState
            title="この月の記録はまだありません"
            description="試合を登録するか、カスタム登録で任意の金額を積み立ててください。"
          />
        ) : (
          <div className="flex flex-col gap-2">
            {records.map((record) => {
              // 中止の日。貯金は入らないので、日付と印だけを出す
              if (record.kind === 'cancelled') {
                const game = record.game
                return (
                  <Card key={`cancelled-${record.date}`} className="!p-3.5 opacity-70">
                    <div className="flex items-center gap-3">
                      <IconFrame tone="default">
                        <IconBaseball size={17} />
                      </IconFrame>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[11px] text-fg-mute">
                          <span className="tnum">{shortDate(record.date)}</span>
                          <span>{game.isHome ? 'ホーム' : 'ビジター'}</span>
                        </div>
                        <div className="mt-1 truncate text-sm text-fg-mute">
                          <span className="line-through">vs {game.opponent}</span>
                        </div>
                      </div>

                      <span className="shrink-0 rounded-full border border-danger/50 px-2 py-0.5 text-[10px] text-danger">
                        {game.note}
                      </span>
                    </div>
                  </Card>
                )
              }

              const entry = record.entry
              const g = entry.game
              const details = g
                ? [
                    g.home_runs > 0 ? `HR ${g.home_runs}` : null,
                    g.grand_slams > 0 ? `満塁HR ${g.grand_slams}` : null,
                    g.multi_hits > 0 ? `マルチ安打 ${g.multi_hits}` : null,
                    g.rbi > 0 ? `打点 ${g.rbi}` : null,
                    g.pitching_highlight !== 'none'
                      ? pitchingHighlightLabel(g.pitching_highlight)
                      : null,
                    g.is_winning_pitcher ? '勝利投手' : null,
                    g.has_save ? 'セーブ' : null,
                    entry.other_note || null,
                  ].filter(Boolean)
                : [entry.other_note || null].filter(Boolean)

              // 現地観戦を押したかどうか。球場を引ける試合にだけボタンを出す
              const visit = g ? visitOfGame(g.id, visits) : null
              const attended = visit !== null

              return (
                <Card key={entry.id} className="!p-3.5">
                  <div className="flex items-start gap-3">
                    <IconFrame tone="marine">
                      {g ? <IconBaseball size={17} /> : <IconSpark size={17} />}
                    </IconFrame>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[11px] text-fg-mute">
                        <span className="tnum">{shortDate(entry.entry_date)}</span>
                        {g && g.phase !== 'regular' ? <span>{phaseLabel(g.phase)}</span> : null}
                        {g ? (
                          // 旧アプリから移行した試合は開催地が分からないので出さない
                          g.home_away ? <span>{homeAwayLabel(g.home_away)}</span> : null
                        ) : (
                          <span>カスタム</span>
                        )}
                      </div>
                      <div className="mt-1 truncate text-sm">
                        {g ? (
                          <>
                            {resultLabel(g.result, g.is_sayonara)}
                            <span className="text-fg-mute"> vs </span>
                            {opponentLabel(g.opponent)}
                            {g.marines_score != null && g.opponent_score != null ? (
                              <span className="tnum text-fg-mute">
                                {' '}
                                {g.marines_score}-{g.opponent_score}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          entry.title
                        )}
                      </div>
                      {details.length > 0 ? (
                        <p className="mt-1 truncate text-[11px] text-fg-mute">{details.join(' / ')}</p>
                      ) : null}

                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <Amount value={entry.amount} size="sm" tone="marine" />
                      <div className="flex gap-1.5">
                        {/* 現地観戦。押すと球場スタンプ帳にスタンプが付く */}
                        {g && stadiumOf(g.stadium) ? (
                          <IconButton
                            label={attended ? '現地観戦（取り消す）' : '現地観戦'}
                            aria-pressed={attended}
                            disabled={busy}
                            onClick={() => toggleAttendance(g)}
                            className={
                              attended ? '!border-marine/60 bg-marine/12 !text-marine' : ''
                            }
                          >
                            <IconTicket size={15} />
                          </IconButton>
                        ) : null}
                        <IconButton
                          label="編集"
                          onClick={() => {
                            setEditing(entry)
                            setSheetMode(entry.kind === 'custom' ? 'custom' : 'game')
                          }}
                        >
                          <IconEdit size={15} />
                        </IconButton>
                        <IconButton
                          label="削除"
                          onClick={() => removeEntry(entry)}
                          className="hover:border-danger/50 hover:text-danger"
                        >
                          <IconTrash size={15} />
                        </IconButton>
                      </div>
                    </div>
                  </div>

                  {/* 現地観戦の一行。押すと一緒に行った人を選べる。
                      アイコンを4つ並べると対戦相手の名前が切れるので、
                      幅の要る同行者はここに置く */}
                  {attended && visit ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setCompanionOf({ visit, game: g! })}
                      className="mt-2 flex w-full items-center gap-1.5 text-left text-[11px] text-marine transition-colors hover:text-marine/80 disabled:opacity-40"
                    >
                      <IconUsers size={13} />
                      <span className="truncate">
                        現地観戦 / {companionLabel(visit.companions, members) ?? '一人で'}
                      </span>
                    </button>
                  ) : null}
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* まだ自分が積み立てていない共通の試合 */}
      {monthUnregistered.length > 0 ? (
        <div>
          <SectionLabel>未登録の試合</SectionLabel>
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px]">
                  この月に {monthUnregistered.length} 試合ぶん、まだ積み立てていません。
                </p>
              </div>
              <Amount value={unregisteredTotal} size="sm" tone="marine" />
            </div>
            <Button
              variant="primary"
              full
              disabled={busy}
              onClick={() => registerGames(monthUnregistered)}
              className="mt-3"
            >
              この月をまとめて積み立てる
            </Button>
          </Card>

          <div className="mt-2 flex flex-col gap-2">
            {monthUnregistered.map((game) => (
              <Card key={game.id} className="!p-3.5">
                <div className="flex items-center gap-3">
                  <IconFrame>
                    <IconBaseball size={17} />
                  </IconFrame>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[11px] text-fg-mute">
                      <span className="tnum">{shortDate(game.game_date)}</span>
                      {game.phase !== 'regular' ? <span>{phaseLabel(game.phase)}</span> : null}
                    </div>
                    <div className="mt-1 truncate text-sm">
                      {resultLabel(game.result, game.is_sayonara)}
                      <span className="text-fg-mute"> vs </span>
                      {opponentLabel(game.opponent)}
                      {game.marines_score != null && game.opponent_score != null ? (
                        <span className="tnum text-fg-mute">
                          {' '}
                          {game.marines_score}-{game.opponent_score}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Amount value={calcSaving(game, rules).amount} size="sm" tone="dim" />
                    <Button
                      onClick={() => registerGames([game])}
                      disabled={busy}
                      className="!min-h-[36px] !px-3 text-[12px]"
                    >
                      積み立てる
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {sheetMode === 'game' ? (
        <GameSheet entry={editing} rules={rules} userId={userId} onClose={closeSheet} />
      ) : null}
      {sheetMode === 'custom' ? (
        <CustomSavingSheet entry={editing} presets={presets} userId={userId} onClose={closeSheet} />
      ) : null}
      {companionOf ? (
        <CompanionSheet
          visit={companionOf.visit}
          game={companionOf.game}
          members={members}
          userId={userId}
          onClose={() => setCompanionOf(null)}
        />
      ) : null}
    </div>
  )
}
