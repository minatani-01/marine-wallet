import { Card, ProgressBar, SectionLabel } from '@/components/ui'
import StadiumArt from '@/components/stadiums/StadiumArt'
import { buildStampCard } from '@/lib/stadium-stamp'
import type { StadiumStamp } from '@/lib/stadium-stamp'
import { opponentLabel } from '@/lib/constants'
import type { Game, StadiumVisit } from '@/types'

/**
 * 球場スタンプ帳（パスポート）。
 *
 * スタンプは訪問記録だけを根拠にする。games.stadium は「マリーンズが
 * 試合をした球場」であって「自分が行った球場」ではない（0038）。
 *
 * 押す操作はここには置かない。貯金の記録一覧に「現地観戦」ボタンがあり、
 * 押すとこの帳面にスタンプが増える。行った試合を思い出しながら探す場所は
 * 試合の並んでいる貯金の画面のほうが自然で、同じ操作を二か所に置くと
 * どちらが正しいのか分からなくなる。
 */

/** 'YYYY-MM-DD' → '2026.04.03'（券面の刻印） */
function stampDate(iso: string): string {
  return iso.replaceAll('-', '.')
}

/** 差し色に透明度を足す。#22d3ee + '33' */
function alpha(hex: string, aa: string): string {
  return `${hex}${aa}`
}

function Ticket({ stamp, total }: { stamp: StadiumStamp; total: number }) {
  const { stadium, no, visited, log } = stamp
  const head = log[0] ?? null
  const accent = stadium.accent

  return (
    <div
      className={`relative overflow-hidden rounded-xl border ${
        visited ? 'border-line bg-white/[0.03]' : 'border-dashed border-line'
      }`}
      style={
        visited
          ? {
              borderColor: alpha(accent, '66'),
              background: `linear-gradient(180deg, ${alpha(accent, '1f')}, rgba(255,255,255,0.02) 62%)`,
            }
          : undefined
      }
    >
      <div className="flex">
        {/* 地方名（縦書き） */}
        <div
          className="flex w-[18px] shrink-0 items-center justify-center border-r border-dashed py-2"
          style={{ borderColor: visited ? alpha(accent, '4d') : undefined }}
        >
          <span
            className="text-[8px] tracking-[0.18em] [writing-mode:vertical-rl]"
            style={{ color: visited ? accent : 'var(--color-fg-mute)' }}
          >
            {stadium.regionEn}
          </span>
        </div>

        <div className="min-w-0 flex-1 px-2.5 pb-2.5 pt-2">
          {/* 通し番号と所在地 */}
          <div className="flex items-baseline justify-between gap-2">
            <span
              className="tnum text-[11px] font-semibold"
              style={{ color: visited ? accent : 'var(--color-fg-mute)' }}
            >
              {String(no).padStart(2, '0')}
              <span className="text-fg-mute">/{total}</span>
            </span>
            <span className="truncate text-[8px] tracking-[0.18em] text-fg-mute">
              {stadium.prefectureEn}
            </span>
          </div>

          {/* 球場の絵 */}
          <div
            className="mt-1.5"
            style={{ color: visited ? accent : 'rgba(107,124,141,0.38)' }}
          >
            <StadiumArt id={stadium.id} shape={stadium.shape} className="h-16 w-full" />
          </div>

          {/* 球場名 */}
          <div className={`mt-1.5 truncate text-[12px] ${visited ? '' : 'text-fg-mute'}`}>
            {stadium.short}
          </div>
          <div className="truncate text-[8px] tracking-[0.12em] text-fg-mute">
            {stadium.nameEn}
          </div>

          {/* 半券：行った日と点数 */}
          <div
            className="mt-2 border-t border-dashed pt-1.5"
            style={{ borderColor: visited ? alpha(accent, '4d') : undefined }}
          >
            <div className="text-[8px] tracking-[0.2em] text-fg-mute">VISITED</div>
            {visited && head ? (
              <>
                <div className="tnum text-[12px] leading-tight">{stampDate(head.date)}</div>
                <div className="tnum truncate text-[10px] text-fg-mute">
                  {head.game ? (
                    <>
                      vs {opponentLabel(head.game.opponent)}
                      {head.score ? <span className="ml-1 text-fg-dim">{head.score}</span> : null}
                    </>
                  ) : (
                    '来場'
                  )}
                </div>
              </>
            ) : (
              <div className="mt-1.5 h-px w-full bg-white/12" />
            )}
            {stamp.visits > 1 ? (
              <div className="tnum mt-0.5 text-[9px] text-fg-mute">ほか {stamp.visits - 1} 回</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function TicketGrid({ stamps, total }: { stamps: StadiumStamp[]; total: number }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
      {stamps.map((stamp) => (
        <Ticket key={stamp.stadium.id} stamp={stamp} total={total} />
      ))}
    </div>
  )
}

export default function StampClient({
  visits,
  games,
}: {
  visits: StadiumVisit[]
  /** 券面に点数を刻むために使う。スタンプの有無には効かない */
  games: Game[]
}) {
  const card = buildStampCard(visits, games)

  /** 観戦した試合を新しい順に。券面に載らない2回目以降もここで見える */
  const log = [...card.home, ...card.regional]
    .flatMap((stamp) => stamp.log.map((v) => ({ stamp, visit: v })))
    .sort((a, b) => b.visit.date.localeCompare(a.visit.date))

  return (
    <div className="flex flex-col gap-6">
      {/* 達成状況 */}
      <Card className="glow">
        <div className="eyebrow">NPB Ballpark Stamp Collection</div>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-dim">
          球場をめぐる。野球を集める。
          <br />
          あなただけのスタンプコレクション。
        </p>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="tnum text-[42px] font-semibold leading-none text-marine">
            {card.homeVisited}
          </span>
          <span className="text-lg text-fg-mute">/ 12</span>
        </div>
        <div className="mt-3">
          <ProgressBar
            value={card.homeVisited}
            max={12}
            label="12球団の本拠地"
            caption={`あと ${12 - card.homeVisited} 球場`}
          />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-fg-mute">
          地方球場は {card.regionalVisited} / {card.regional.length} です。
          スタンプは貯金の記録から「現地観戦」を押した試合にだけ付きます。
        </p>
      </Card>

      {/* 本拠地 */}
      <div>
        <SectionLabel>本拠地</SectionLabel>
        <TicketGrid stamps={card.home} total={12} />
      </div>

      {/* 地方球場 */}
      <div>
        <SectionLabel>地方球場</SectionLabel>
        <TicketGrid stamps={card.regional} total={card.regional.length} />
      </div>

      {/* 観戦した試合 */}
      <div>
        <SectionLabel>観戦した試合</SectionLabel>
        <Card>
          {log.length === 0 ? (
            <p className="py-2 text-[13px] text-fg-mute">
              まだ記録がありません。貯金の記録一覧で、行った試合の「現地観戦」を押してください。
            </p>
          ) : (
            <div className="divide-hairline">
              {log.slice(0, 30).map(({ stamp, visit }) => (
                <div key={visit.visitId} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm">
                      <span className="tnum">{stampDate(visit.date)}</span>
                      <span className="ml-2 text-fg-dim">{stamp.stadium.short}</span>
                    </div>
                    <div className="tnum truncate text-[11px] text-fg-mute">
                      {visit.game
                        ? `vs ${opponentLabel(visit.game.opponent)}${visit.score ? ` ${visit.score}` : ''}`
                        : '試合以外の来場'}
                    </div>
                  </div>
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: stamp.stadium.accent }}
                  />
                </div>
              ))}
            </div>
          )}
          {log.length > 30 ? (
            <p className="mt-3 text-[11px] text-fg-mute">ほか {log.length - 30} 件</p>
          ) : null}
        </Card>
      </div>
    </div>
  )
}
