'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, Segmented } from '@/components/ui'
import StadiumArt from '@/components/stadiums/StadiumArt'
import { buildStampCard } from '@/lib/stadium-stamp'
import { stadiumById } from '@/lib/stadiums'
import { countdownUnit, opponentLabel } from '@/lib/constants'
import { formatWinRate } from '@/lib/insights'
import { shortDate } from '@/lib/format'
import { familyName } from '@/lib/npb/milestones'
import type { SeasonRecord } from '@/lib/insights'
import type { Game, StadiumVisit, UpcomingMilestoneRow } from '@/types'

/**
 * ホームの1枠を3つの見方で切り替える。
 *
 * 勝率・観戦・記録はどれも「今シーズンの見どころ」だが、同時に3枚並べると
 * ホームが縦に伸びて、下の貯金推移まで届かなくなる。枠は1つにして選ばせる。
 *
 * 観戦はスタンプを新しい順に横へ並べる。行った球場は増えていく一方なので、
 * 縦に積むと古いものが下へ流れて見えなくなる。横なら遡る操作がそのまま
 * 「過去へ戻る」になる。
 */

type Tab = 'rate' | 'visit' | 'record'

const TABS: { id: Tab; label: string }[] = [
  { id: 'rate', label: '勝率' },
  { id: 'visit', label: '観戦' },
  { id: 'record', label: '記録' },
]

/** 'YYYY-MM-DD' → '2026.09.16' */
function stampDate(iso: string): string {
  return iso.replaceAll('-', '.')
}

export default function HomePanels({
  record,
  upcoming,
  visits,
  games,
}: {
  record: SeasonRecord
  upcoming: UpcomingMilestoneRow[]
  visits: StadiumVisit[]
  /** スタンプに点数を刻むために使う */
  games: Game[]
}) {
  const [tab, setTab] = useState<Tab>('rate')

  const card = useMemo(() => buildStampCard(visits, games), [visits, games])

  /** 観戦したぶんを新しい順に。右へ送るほど過去へ戻る */
  const log = useMemo(
    () =>
      [...card.home, ...card.regional]
        .flatMap((stamp) => stamp.log.map((visit) => ({ no: stamp.no, visit, id: stamp.stadium.id })))
        .sort((a, b) => b.visit.date.localeCompare(a.visit.date)),
    [card]
  )

  return (
    <div>
      <Segmented value={tab} options={TABS} onChange={setTab} />

      <Card className="mt-2">
        {tab === 'rate' ? (
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[10px] tracking-wider text-fg-mute">今季の勝率</div>
              <div className="tnum mt-1.5 text-xl font-semibold text-marine">
                {formatWinRate(record.rate)}
              </div>
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
        ) : null}

        {tab === 'visit' ? (
          <div>
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-[10px] tracking-wider text-fg-mute">現地観戦</div>
                <div className="mt-1.5 flex items-baseline gap-1.5">
                  <span className="tnum text-xl font-semibold text-marine">
                    {card.homeVisited}
                  </span>
                  <span className="text-[13px] text-fg-mute">/ 12 球団の本拠地</span>
                </div>
              </div>
              <Link
                href="/stadiums"
                className="shrink-0 text-[12px] text-fg-mute underline underline-offset-2 transition-colors hover:text-marine"
              >
                スタンプ帳
              </Link>
            </div>

            {log.length === 0 ? (
              <p className="mt-3 text-[13px] leading-relaxed text-fg-mute">
                まだスタンプがありません。貯金の記録一覧で、行った試合の「現地観戦」を押してください。
              </p>
            ) : (
              /* 端まで並べたいので、カードの余白ぶんだけ外へ出す */
              <div className="scroll-x mt-3 -mx-4 overflow-x-auto px-4">
                <div className="flex w-max gap-2.5">
                  {log.map(({ no, visit, id }) => {
                    const stadium = stadiumById(id)
                    if (!stadium) return null

                    return (
                      <div
                        key={visit.visitId}
                        className="border-marine/45 from-marine/12 w-[104px] shrink-0 rounded-xl border bg-gradient-to-b to-white/[0.02] px-2 pt-1.5 pb-2"
                      >
                        <div className="flex items-baseline justify-between gap-1">
                          {/* 通し番号はスタンプ帳と同じもの。地方球場は番号を持たない */}
                          <span className="tnum text-marine text-[10px] font-semibold">
                            {stadium.kind === 'home' ? String(no).padStart(2, '0') : ''}
                          </span>
                          <span className="truncate text-[7px] tracking-[0.16em] text-fg-mute">
                            {stadium.prefectureEn}
                          </span>
                        </div>
                        <div className="text-marine">
                          <StadiumArt id={stadium.id} shape={stadium.shape} className="h-10 w-full" />
                        </div>
                        <div className="mt-0.5 truncate text-[11px]">{stadium.short}</div>
                        <div className="tnum truncate text-[9px] text-fg-mute">
                          {stampDate(visit.date)}
                        </div>
                        <div className="tnum truncate text-[9px] text-fg-mute">
                          {visit.game
                            ? `vs ${opponentLabel(visit.game.opponent)}${visit.score ? ` ${visit.score}` : ''}`
                            : '来場'}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        ) : null}

        {tab === 'record' ? (
          <div>
            <div className="text-[10px] tracking-wider text-fg-mute">まもなく達成する記録</div>
            {upcoming.length === 0 ? (
              <p className="mt-2 text-[13px] text-fg-mute">近いうちに届きそうな記録はありません。</p>
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
                    {/* 行をまたいで「あと」の位置を揃える。数と単位はどちらも
                        長さが変わるので、それぞれ幅を決めて数は右寄せ・単位は左寄せ */}
                    <div className="flex shrink-0 items-baseline">
                      <span className="text-lg font-semibold text-marine">あと</span>
                      <span className="tnum w-10 text-right text-lg font-semibold text-marine">
                        {item.remaining.toLocaleString()}
                      </span>
                      <span className="ml-1 w-12 text-[11px] text-fg-mute">
                        {countdownUnit(item.unit)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </Card>
    </div>
  )
}
