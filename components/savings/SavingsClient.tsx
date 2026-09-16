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
  IconTrash,
} from '@/components/icons'
import { CopyAmountButton, OpenAppButton } from '@/components/HandoffActions'
import GameSheet from '@/components/savings/GameSheet'
import CustomSavingSheet from '@/components/savings/CustomSavingSheet'
import { createClient } from '@/lib/supabase/client'
import { BREAKDOWN_GROUP_LABEL, calcSaving, groupBreakdown } from '@/lib/savings'
import { depositedTotal, notDepositedTotal } from '@/lib/insights'
import { notifyMonthConfirmed } from '@/lib/notify-client'
import { currentMonth, monthLabel, monthLabelEn, shortDate, yen } from '@/lib/format'
import {
  MONTHLY_STATUS_LABEL,
  homeAwayLabel,
  opponentLabel,
  phaseLabel,
  pitchingHighlightLabel,
  resultLabel,
} from '@/lib/constants'
import type {
  MonthlySaving,
  MonthlyStatus,
  Game,
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
}) {
  const router = useRouter()
  const [sheetMode, setSheetMode] = useState<SheetMode | null>(null)
  const [editing, setEditing] = useState<SavingEntryRow | null>(null)
  const [addMode, setAddMode] = useState<SheetMode>('game')
  const [busy, setBusy] = useState(false)
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
    if (!window.confirm(`${shortDate(entry.entry_date)} の記録を削除しますか？`)) return
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
          <p className="mt-3 text-[11px] leading-relaxed text-fg-mute">
            {addMode === 'game'
              ? '試合結果を登録すると、貯金ルールに沿って積立予定額を自動計算します。'
              : 'マルチ安打や打点など、試合結果から自動計算できない分をここで積み立てます。フェーズ倍率は適用されません。'}
          </p>
          <Button variant="primary" full className="mt-3" onClick={openAdd}>
            {addMode === 'game' ? '試合を登録する' : 'カスタム登録を追加する'}
            <IconChevronRight size={16} />
          </Button>
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

      {/* 記録一覧 */}
      <div>
        <SectionLabel>Records</SectionLabel>

        {monthEntries.length === 0 ? (
          <EmptyState
            title="この月の記録はまだありません"
            description="試合を登録するか、カスタム登録で任意の金額を積み立ててください。"
          />
        ) : (
          <div className="flex flex-col gap-2">
            {monthEntries.map((entry) => {
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
                <p className="mt-1 text-[11px] leading-relaxed text-fg-mute">
                  試合データは全員共通です。共通の貯金ルールで計算して積み立てます。
                  接続済みのアカウントには自動で立つので、ここに出るのは取りこぼしだけです。
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
    </div>
  )
}
