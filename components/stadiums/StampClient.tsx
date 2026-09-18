'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, ProgressBar, SectionLabel } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { buildStampCard, uncheckedGames, visitFromGame } from '@/lib/stadium-stamp'
import type { StadiumStamp } from '@/lib/stadium-stamp'
import { opponentLabel } from '@/lib/constants'
import { shortDate } from '@/lib/format'
import { tapFeedback } from '@/lib/haptics'
import type { Game, StadiumVisit } from '@/types'

/**
 * 球場スタンプラリー。
 *
 * 12球団の本拠地をいくつ回ったかを出す。スタンプの根拠は訪問記録だけで、
 * 試合データからは付けない。games.stadium は「マリーンズが試合をした球場」
 * であって「自分が行った球場」ではないため（0038）。
 *
 * 行った試合を1つずつ探すのは大変なので、こちらから候補を出して
 * 押すだけで済むようにする。
 */

/** 1回に出す候補の数。全部出すと126件並ぶ */
const CANDIDATE_STEP = 12

function StampRow({ stamp }: { stamp: StadiumStamp }) {
  const { stadium, visited, firstVisit, visits, games } = stamp

  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
            visited
              ? 'border-marine/70 bg-marine/12 text-marine'
              : 'border-dashed border-line text-fg-mute'
          }`}
        >
          {visited ? '済' : '—'}
        </span>
        <div className="min-w-0">
          <div className={`truncate text-sm ${visited ? '' : 'text-fg-mute'}`}>
            {stadium.short}
          </div>
          <div className="tnum truncate text-[11px] text-fg-mute">
            {visited
              ? `初 ${shortDate(firstVisit!)} / ${visits}回${games > 0 ? `（観戦${games}）` : ''}`
              : 'まだ行っていません'}
          </div>
        </div>
      </div>
      {stadium.team ? (
        <span className="shrink-0 text-[11px] text-fg-mute">{opponentLabel(stadium.team)}</span>
      ) : null}
    </div>
  )
}

export default function StampClient({
  userId,
  visits,
  games,
}: {
  userId: string
  visits: StadiumVisit[]
  /** 共通の試合。行った試合を押して記録するのに使う */
  games: Game[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState(CANDIDATE_STEP)
  const [error, setError] = useState<string | null>(null)

  const card = useMemo(() => buildStampCard(visits), [visits])
  const candidates = useMemo(() => uncheckedGames(games, visits), [games, visits])

  /** 観戦した試合を記録する。押した試合の球場にスタンプが付く */
  const checkIn = async (game: Game) => {
    const from = visitFromGame(game)
    if (!from) return

    tapFeedback()
    setBusy(true)
    setError(null)

    const supabase = createClient()
    const { error: saveError } = await supabase.from('stadium_visits').insert({
      user_id: userId,
      stadium_id: from.stadium_id,
      visited_on: from.visited_on,
      game_id: game.id,
    })

    setBusy(false)
    if (saveError) {
      setError('記録できませんでした')
      return
    }
    router.refresh()
  }

  /** 押し間違えたときに取り消す */
  const undo = async (gameId: string) => {
    const target = visits.find((v) => v.game_id === gameId)
    if (!target) return

    setBusy(true)
    const supabase = createClient()
    await supabase.from('stadium_visits').delete().eq('id', target.id)
    setBusy(false)
    router.refresh()
  }

  const checked = useMemo(
    () =>
      games
        .filter((g) => visits.some((v) => v.game_id === g.id))
        .sort((a, b) => b.game_date.localeCompare(a.game_date)),
    [games, visits]
  )

  return (
    <div className="flex flex-col gap-6">
      {/* 達成状況 */}
      <Card className="glow">
        <div className="eyebrow">12球団の本拠地</div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="tnum text-[42px] font-semibold leading-none text-marine">
            {card.homeVisited}
          </span>
          <span className="text-lg text-fg-mute">/ 12</span>
        </div>
        <div className="mt-3">
          <ProgressBar
            value={card.homeVisited}
            max={12}
            label="制覇まで"
            caption={`あと ${12 - card.homeVisited} 球場`}
          />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-fg-mute">
          地方球場は {card.regionalVisited} / {card.regional.length} です。
          スタンプは「行った」と記録した試合にだけ付きます。
        </p>
      </Card>

      {/* 本拠地 */}
      <div>
        <SectionLabel>本拠地</SectionLabel>
        <Card>
          <div className="divide-hairline">
            {card.home.map((stamp) => (
              <StampRow key={stamp.stadium.id} stamp={stamp} />
            ))}
          </div>
        </Card>
      </div>

      {/* 地方球場 */}
      <div>
        <SectionLabel>地方球場</SectionLabel>
        <Card>
          <div className="divide-hairline">
            {card.regional.map((stamp) => (
              <StampRow key={stamp.stadium.id} stamp={stamp} />
            ))}
          </div>
        </Card>
      </div>

      {/* 行った試合を記録する */}
      <div>
        <SectionLabel>行った試合を記録する</SectionLabel>
        <Card>
          <p className="mb-3 text-[11px] leading-relaxed text-fg-mute">
            観戦した試合を押すと、その球場にスタンプが付きます。
            試合データは全員で共通ですが、行ったかどうかは人ごとに記録します。
          </p>

          {error ? <p className="mb-2 text-[13px] text-danger">{error}</p> : null}

          {candidates.length === 0 ? (
            <p className="py-2 text-[13px] text-fg-mute">記録していない試合はありません。</p>
          ) : (
            <>
              <div className="divide-hairline">
                {candidates.slice(0, shown).map((game) => (
                  <div key={game.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm">
                        {shortDate(game.game_date)} {opponentLabel(game.opponent)}戦
                      </div>
                      <div className="truncate text-[11px] text-fg-mute">{game.stadium}</div>
                    </div>
                    <Button
                      variant="outline"
                      className="shrink-0 !min-h-[38px] !px-3 text-[13px]"
                      disabled={busy}
                      onClick={() => checkIn(game)}
                    >
                      行った
                    </Button>
                  </div>
                ))}
              </div>

              {candidates.length > shown ? (
                <button
                  type="button"
                  onClick={() => setShown((n) => n + CANDIDATE_STEP)}
                  className="mt-3 w-full text-[12px] text-fg-mute underline underline-offset-2 transition-colors hover:text-marine"
                >
                  もっと見る（残り {candidates.length - shown} 試合）
                </button>
              ) : null}
            </>
          )}
        </Card>
      </div>

      {/* 記録済み */}
      {checked.length > 0 ? (
        <div>
          <SectionLabel>観戦した試合</SectionLabel>
          <Card>
            <div className="divide-hairline">
              {checked.slice(0, 20).map((game) => (
                <div key={game.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm">
                      {shortDate(game.game_date)} {opponentLabel(game.opponent)}戦
                    </div>
                    <div className="truncate text-[11px] text-fg-mute">{game.stadium}</div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => undo(game.id)}
                    className="shrink-0 text-[12px] text-fg-mute underline underline-offset-2 transition-colors hover:text-danger disabled:opacity-40"
                  >
                    取り消す
                  </button>
                </div>
              ))}
            </div>
            {checked.length > 20 ? (
              <p className="mt-3 text-[11px] text-fg-mute">ほか {checked.length - 20} 試合</p>
            ) : null}
          </Card>
        </div>
      ) : null}
    </div>
  )
}
