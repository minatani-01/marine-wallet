import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Amount, Card, SectionLabel, StatusPill } from '@/components/ui'
import { IconChevronRight, IconUsers, IconWallet } from '@/components/icons'
import SavingsTrend from '@/components/home/SavingsTrend'
import type { ChartPoint } from '@/components/charts/CumulativeChart'
import {
  getMonthlySavings,
  getSavingEntries,
  getSessionUser,
  getSavingCircleTotals,
  getUpcomingMilestones,
} from '@/lib/queries'
import {
  depositedMonthSet,
  depositedTotal,
  formatWinRate,
  seasonRecord,
  streakDays,
} from '@/lib/insights'
import { currentMonth, isMonthClosed, monthLabel, shortDate, today, yen } from '@/lib/format'
import { MONTHLY_STATUS_LABEL } from '@/lib/constants'
import { familyName } from '@/lib/npb/milestones'
import type { MonthlyStatus } from '@/types'

const STATUS_TONE: Record<MonthlyStatus, 'neutral' | 'marine' | 'warn' | 'done'> = {
  calculating: 'neutral',
  ready: 'marine',
  deposited: 'done',
}

export default async function HomePage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // ホームは貯金ルールを使わない（年間目標を外したため）。1クエリ減らす
  const [entries, monthlySavings, circle, upcoming] = await Promise.all([
    getSavingEntries(user.id),
    getMonthlySavings(user.id),
    getSavingCircleTotals(),
    // まもなく達成する記録。近いものから3件だけ
    getUpcomingMilestones(3),
  ])

  const month = currentMonth()
  // 累計貯金額は「ワンバンクへ入金した月」の合計。確定しただけの月は含めない。
  // 定義は lib/insights.ts の depositedTotal に集約してあり、貯金・履歴と同じ値になる
  const myTotal = depositedTotal(monthlySavings)
  // 総累計は自分の分を myTotal で置き換えて、1人分の表示と必ず一致させる
  const circleTotal =
    myTotal + circle.filter((row) => !row.is_self).reduce((sum, row) => sum + row.confirmed, 0)
  const circleSize = circle.filter((row) => row.is_visible).length
  const monthEntries = entries.filter((e) => e.month === month)
  const monthTotal = monthEntries.reduce((sum, e) => sum + e.amount, 0)
  const streak = streakDays(entries)

  // 貯金推移。入金済みの月だけを積む（累計貯金額と同じ定義）。
  // 当年の月別と、全期間の年別の2本を作り、画面側で切り替える
  const deposited = depositedMonthSet(monthlySavings)
  const thisYear = Number(today().slice(0, 4))

  const byMonth = new Map<string, number>()
  const byYear = new Map<string, number>()
  for (const entry of entries) {
    if (!deposited.has(entry.month)) continue
    byMonth.set(entry.month, (byMonth.get(entry.month) ?? 0) + entry.amount)
    const y = entry.month.slice(0, 4)
    byYear.set(y, (byYear.get(y) ?? 0) + entry.amount)
  }

  const monthlyPoints: ChartPoint[] = []
  {
    let cumulative = 0
    for (const month of [...byMonth.keys()].sort()) {
      if (!month.startsWith(`${thisYear}-`)) continue
      cumulative += byMonth.get(month) ?? 0
      monthlyPoints.push({ label: `${Number(month.slice(5, 7))}月`, value: cumulative })
    }
  }

  const yearlyPoints: ChartPoint[] = []
  {
    let cumulative = 0
    for (const y of [...byYear.keys()].sort()) {
      cumulative += byYear.get(y) ?? 0
      yearlyPoints.push({ label: `${y}年`, value: cumulative })
    }
  }

  // 今季の戦績。貯金の記録に紐づく試合から数える（記録＝その年の試合そのもの）
  const record = seasonRecord(entries, thisYear)

  // 締めが終わっているのに入金まで進んでいない月をホームで先に促す
  // 締めが終わった月のうち、まだワンバンクへ入金していないもの。
  // 何か月も溜まることがあるので、一番古い月を先頭にして件数も出す。
  // 直近の月だけを名指しすると「8月分が未入金」と読めてしまい、
  // 実際には3月から溜まっていることが伝わらない。
  const pendingMonths = monthlySavings
    .filter((m) => m.status !== 'deposited' && isMonthClosed(m.month))
    .sort((a, b) => a.month.localeCompare(b.month))
  const oldestPending = pendingMonths[0] ?? null
  const newestPending = pendingMonths[pendingMonths.length - 1] ?? null

  // 締めが終わっているのに月末確定すらしていない月
  const unconfirmedClosedMonth = [...new Set(entries.map((e) => e.month))]
    .filter((m) => isMonthClosed(m))
    .sort((a, b) => a.localeCompare(b))
    .find((m) => !monthlySavings.some((row) => row.month === m))
  const alertMonth = oldestPending?.month ?? unconfirmedClosedMonth ?? null

  const pendingLabel = (() => {
    if (!oldestPending || !newestPending) return ''
    if (pendingMonths.length === 1) {
      return `${monthLabel(oldestPending.month)}分のワンバンク入金が残っています`
    }
    return `${monthLabel(oldestPending.month)}〜${monthLabel(newestPending.month)}の${pendingMonths.length}か月分のワンバンク入金が残っています`
  })()

  return (
    <div className="flex flex-col gap-6">
      {/* ヒーロー */}
      <div>
        <p className="text-[22px] leading-snug font-semibold tracking-wide">
          好きが、
          <br />
          未来をつくる。
        </p>
        <p className="mt-2 text-[10px] tracking-[0.28em] text-fg-mute uppercase">More than a game</p>
      </div>

      {/* 累計 */}
      <Card className="glow">
        <div className="eyebrow">累計貯金額</div>
        <div className="mt-2">
          <Amount value={myTotal} size="xl" tone="marine" />
        </div>
        <div className="mt-1 text-[11px] text-fg-mute">
          1人分 / ワンバンクへ入金した金額の合計
        </div>

        {/* 1人分と同じ「見出し → 金額 → 内訳」の並びにして、2つを同じ文脈で読めるようにする */}
        {circleSize > 1 ? (
          <div className="mt-3 border-t border-line pt-3">
            <div className="eyebrow">総累計貯金額</div>
            <div className="mt-2">
              <Amount value={circleTotal} size="xl" tone="marine" />
            </div>
            <div className="mt-1 text-[11px] text-fg-mute">
              {circleSize}人分 / 合算しているメンバーを含む合計
            </div>
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4">
          <div>
            <div className="text-[10px] tracking-wider text-fg-mute">今月のつみたて額</div>
            <div className="tnum mt-1 text-lg font-semibold">{yen(monthTotal)}</div>
          </div>
          <div>
            <div className="text-[10px] tracking-wider text-fg-mute">継続日数</div>
            <div className="tnum mt-1 text-lg font-semibold">{streak}日</div>
          </div>
        </div>
      </Card>

      {/* 主要CTA */}
      <div className="flex flex-col gap-2">
        <Link
          href="/savings"
          prefetch={false}
          className="flex min-h-[54px] items-center justify-between gap-3 rounded-2xl bg-marine px-4 font-semibold text-ink shadow-[0_0_40px_-16px_rgba(34,211,238,0.9)] transition-colors hover:bg-teal"
        >
          <span className="flex items-center gap-2.5">
            <IconWallet size={19} />
            貯金する
          </span>
          <IconChevronRight size={18} />
        </Link>
        <Link
          // 「作成」なので、割り勘タブを開くだけでなく登録シートまで開く
          href="/split?new=1"
          prefetch={false}
          className="glass flex min-h-[54px] items-center justify-between gap-3 rounded-2xl px-4 transition-colors hover:border-marine/50"
        >
          <span className="flex items-center gap-2.5 text-sm">
            <IconUsers size={19} />
            割り勘を作成
          </span>
          <IconChevronRight size={18} />
        </Link>
      </div>

      {/* まもなく達成する記録。達成すると自動登録で貯金に入るので、
          ここに出しておくと「次に何が入るか」が先に分かる */}
      <Card>
        <div className="text-[10px] tracking-wider text-fg-mute">まもなく達成する記録</div>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-[13px] text-fg-mute">
            近いうちに届きそうな記録はありません。
          </p>
        ) : (
          <div className="mt-1 divide-hairline">
            {upcoming.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm">
                    {item.uniform_number ? `#${item.uniform_number}` : ''}
                    {familyName(item.holder)}
                  </div>
                  <div className="tnum truncate text-[11px] text-fg-mute">
                    通算{item.record_label} / 現在 {item.current.toLocaleString()}
                    {item.unit}
                  </div>
                </div>
                <div className="tnum shrink-0 text-lg font-semibold text-marine">
                  あと{item.remaining.toLocaleString()}
                  <span className="ml-0.5 text-[11px] font-normal text-fg-mute">{item.unit}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 試合数ではなく戦績を出す。登録は試合のあとになるので、
          「何試合ぶん記録したか」より「今季どうだったか」の方が読む意味がある。
          どこまでの結果かが分かるよう、最後に記録した試合の日付を添える */}
      <Card>
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] tracking-wider text-fg-mute">今季の勝率</div>
            <div className="tnum mt-1.5 text-xl font-semibold">{formatWinRate(record.rate)}</div>
          </div>
          <div className="text-right">
            <div className="tnum text-[13px] text-fg-dim">
              {record.win}勝{record.lose}敗{record.draw}分
            </div>
            {record.lastGameDate ? (
              <div className="tnum mt-0.5 text-[11px] text-fg-mute">
                {shortDate(record.lastGameDate)}まで
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      {/* 月末の入金誘導 */}
      {alertMonth ? (
        <Card>
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm">
              {oldestPending ? pendingLabel : `${monthLabel(alertMonth)}分の金額がまだ確定していません`}
            </p>
            {oldestPending ? (
              <StatusPill tone={STATUS_TONE[oldestPending.status]}>
                {MONTHLY_STATUS_LABEL[oldestPending.status]}
              </StatusPill>
            ) : null}
          </div>
          <Link
            href="/savings"
            prefetch={false}
            className="mt-4 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-marine/60 px-4 text-sm font-medium text-marine transition-colors hover:bg-marine/10"
          >
            月末の積立状況を見る
          </Link>
        </Card>
      ) : null}

      {/* 貯金推移。入金済みの月だけを積む（累計貯金額と同じ定義） */}
      <div>
        <SectionLabel
          action={
            <Link
              href="/history"
              prefetch={false}
              className="text-[12px] text-fg-dim hover:text-marine"
            >
              履歴を見る
            </Link>
          }
        >
          貯金推移
        </SectionLabel>

        <SavingsTrend year={thisYear} monthly={monthlyPoints} yearly={yearlyPoints} />
      </div>

    </div>
  )
}
