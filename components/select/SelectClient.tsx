'use client'

import { useMemo, useState } from 'react'

import FavoriteSheet from '@/components/select/FavoriteSheet'
import { IconExternal, IconGoods, IconPlus } from '@/components/icons'
import { Button, EmptyState, PillTabs, SectionLabel } from '@/components/ui'
import { withTapFeedback } from '@/lib/haptics'
import {
  ALL_GENRES,
  filterByGenre,
  genresOf,
  imageSrc,
  isBorrowedImage,
  priceText,
  sortItems,
} from '@/lib/favorites'
import type { FavoriteItemRow } from '@/types'

/**
 * お気に入りの品の一覧（RE:SELECT）。
 *
 * もとの Google Apps Script のアプリと同じ見せ方にしてある。ジャンルで絞り、
 * 画像付きの札を並べ、押すと買える場所へ飛ぶ。並び順も同じ（表示順 →
 * ジャンル → 名前）。並びが変わると、置き場所で覚えているものが探せなくなる。
 *
 * 札そのものを買う場所へのリンクにはしない。買うのは年に数回で、直すほうが
 * 多いので、面を編集、隅の矢印を購入に割り当てる。
 */
export default function SelectClient({
  userId,
  items,
}: {
  userId: string
  items: FavoriteItemRow[]
}) {
  const [genre, setGenre] = useState<string>(ALL_GENRES)
  /** 編集中の品。null は「追加」で開いたとき。閉じているあいだは undefined */
  const [editing, setEditing] = useState<FavoriteItemRow | null | undefined>(undefined)

  const sorted = useMemo(() => sortItems(items) as FavoriteItemRow[], [items])

  /** image_path に対して発行済みの署名付きURL。lib 側は Map だけを見る */
  const signed = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of sorted) {
      if (item.image_path && item.signed_url) map.set(item.image_path, item.signed_url)
    }
    return map
  }, [sorted])

  const genres = useMemo(() => genresOf(sorted), [sorted])
  const shown = useMemo(() => filterByGenre(sorted, genre) as FavoriteItemRow[], [sorted, genre])

  // 選んでいたジャンルが空になることがある（最後の1件を外したとき）。
  // そのまま空の画面を出さず、すべてに戻して出す
  const list = shown.length === 0 && genre !== ALL_GENRES ? sorted : shown

  const genreOptions = useMemo(
    () => [{ id: ALL_GENRES, label: `すべて ${sorted.length}` }, ...genres.map((g) => ({ id: g, label: g }))],
    [genres, sorted.length]
  )

  // 画像がまだ Drive 任せのもの。入れ直すまで、相手側が消すと出なくなる
  const borrowed = useMemo(() => sorted.filter(isBorrowedImage).length, [sorted])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel>RE:SELECT</SectionLabel>
          <p className="text-[11px] leading-relaxed text-fg-mute">
            また買うもの・欲しいものを、ジャンル別に置いておく場所です。
          </p>
        </div>
        <Button variant="primary" onClick={withTapFeedback(() => setEditing(null))}>
          <IconPlus size={16} />
          追加
        </Button>
      </div>

      {borrowed > 0 ? (
        <p className="rounded-xl border border-warn/40 bg-warn/[0.06] px-3.5 py-2.5 text-[11px] leading-relaxed text-warn">
          {borrowed}件の画像は、まだ Google Drive から借りています。編集して写真を選び直すと、
          このアプリの中に入って消えなくなります。
        </p>
      ) : null}

      {sorted.length === 0 ? (
        <EmptyState
          title="まだ何も入っていません"
          description="「追加」から、また買うものを入れておけます。"
        />
      ) : (
        <>
          {genres.length > 1 ? (
            <PillTabs value={genre} options={genreOptions} onChange={setGenre} />
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            {list.map((item) => {
              const src = imageSrc(item, signed)
              const price = priceText(item.price)
              return (
                <div key={item.id} className="glass relative overflow-hidden rounded-2xl">
                  <button
                    type="button"
                    onClick={withTapFeedback(() => setEditing(item))}
                    aria-label={`${item.name}を編集`}
                    className="block w-full text-left transition-colors hover:bg-white/[0.03]"
                  >
                    {/* 正方形で切り抜く。縦長・横長が混ざると棚が揃わない */}
                    <div className="relative aspect-square w-full bg-ink-2">
                      {src ? (
                        <img src={src} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-fg-mute">
                          <IconGoods size={26} />
                        </span>
                      )}
                      <span className="absolute top-1.5 left-1.5 rounded-full border border-line bg-ink/85 px-2 py-0.5 text-[10px] text-fg-dim backdrop-blur">
                        {item.status}
                      </span>
                    </div>

                    <div className="space-y-1 p-2.5">
                      {item.brand ? (
                        <p className="truncate text-[10px] text-fg-mute">{item.brand}</p>
                      ) : null}
                      {/* 名前は2行まで。3行になる品があると札の高さが揃わない */}
                      <p className="line-clamp-2 text-[12px] leading-snug text-fg">{item.name}</p>
                      <div className="flex items-baseline justify-between gap-1.5">
                        <span className="tnum text-[12px] font-semibold text-marine">
                          {price || '—'}
                        </span>
                        {item.shop_name ? (
                          <span className="min-w-0 truncate text-[10px] text-fg-mute">
                            {item.shop_name}
                          </span>
                        ) : null}
                      </div>
                      {item.memo ? (
                        <p className="line-clamp-2 text-[10px] leading-snug text-fg-mute">
                          {item.memo}
                        </p>
                      ) : null}
                    </div>
                  </button>

                  {item.shop_url ? (
                    <a
                      href={item.shop_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={`${item.name}を買う`}
                      title="買える場所を開く"
                      className="absolute top-1.5 right-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-ink/85 text-fg-dim backdrop-blur transition-colors hover:border-marine/60 hover:text-marine"
                    >
                      <IconExternal size={14} />
                    </a>
                  ) : null}
                </div>
              )
            })}
          </div>
        </>
      )}

      {editing !== undefined ? (
        <FavoriteSheet
          item={editing}
          userId={userId}
          genreOptions={genres}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </div>
  )
}
