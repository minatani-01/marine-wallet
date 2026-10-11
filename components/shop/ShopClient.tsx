'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import FavoriteSheet from '@/components/shop/FavoriteSheet'
import { IconExternal, IconGoods, IconPlus } from '@/components/icons'
import { Button, EmptyState, PillTabs } from '@/components/ui'
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
 * また買うもの・欲しいものの一覧（RE:SELECT）。
 *
 * もとの Google Apps Script のアプリと同じ見せ方にしてある。ジャンルで絞り、
 * 画像付きの札を並べ、押すと買える場所へ飛ぶ。並び順も同じ（表示順 →
 * ジャンル → 名前）。並びが変わると、置き場所で覚えているものが探せなくなる。
 *
 * 画面の上には説明を置かない。題はヘッダーに出ているし、何の画面かは
 * 品が並んでいれば分かる。文章を足すぶん、品が1行ぶん下へ追いやられる。
 * 「追加」も上に置かず、右下に浮かせる。一覧を見ているときに押すものなので、
 * 上まで戻らせない。
 */
export default function ShopClient({
  userId,
  items,
}: {
  userId: string
  items: FavoriteItemRow[]
}) {
  const [genre, setGenre] = useState<string>(ALL_GENRES)
  /**
   * 読めなかった画像。
   *
   * 借りているURLは、向こうの共有設定が変わるとある日読めなくなる。
   * そのとき src だけ残ると、黒い枠が並んで壊れて見える。読めなかったものは
   * 枠ごと品の絵に差し替える。
   */
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const markBroken = (id: string) =>
    setBroken((held) => (held.has(id) ? held : new Set(held).add(id)))
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
    () => [
      { id: ALL_GENRES, label: `すべて ${sorted.length}` },
      ...genres.map((g) => ({ id: g, label: g })),
    ],
    [genres, sorted.length]
  )

  // 画像がまだ Drive 任せのもの。取り込みが済めばこの行は出なくなる
  const borrowed = useMemo(() => sorted.filter(isBorrowedImage), [sorted])

  return (
    <div className="space-y-4">
      {genres.length > 1 ? (
        <PillTabs value={genre} options={genreOptions} onChange={setGenre} />
      ) : null}

      {borrowed.length > 0 ? <AdoptImages count={borrowed.length} /> : null}

      {sorted.length === 0 ? (
        <EmptyState
          title="まだ何も入っていません"
          description="右下の + から、また買うものを入れておけます。"
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 pb-16">
          {list.map((item) => {
            const src = broken.has(item.id) ? null : imageSrc(item, signed)
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
                      <img
                        src={src}
                        alt=""
                        // 読み込みに失敗したものは枠ごと差し替える。onError だけだと、
                        // 画面を組み立てる前に失敗したぶんを取りこぼす（催促が
                        // 届く前に終わっている）。付いた時点でも一度確かめる
                        ref={(el) => {
                          if (el && el.complete && el.naturalWidth === 0) markBroken(item.id)
                        }}
                        onError={() => markBroken(item.id)}
                        className="h-full w-full object-cover"
                      />
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
      )}

      {/* 追加は右下に浮かせる。下のタブに重ならない高さへ逃がし、
          広い画面でも本文と同じ幅の中に収める */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-lg justify-end px-4">
        <button
          type="button"
          aria-label="お気に入りを追加"
          onClick={withTapFeedback(() => setEditing(null))}
          className="pointer-events-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-marine text-ink shadow-[0_10px_30px_-8px_rgba(34,211,238,0.8)] transition-colors hover:bg-teal"
        >
          <IconPlus size={24} />
        </button>
      </div>

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

/**
 * Drive に置いたままの画像を、アプリの中へ移す。
 *
 * 移行ぶんは借りているURLしか持たない。Drive 側を片付けたり共有を変えたり
 * すると、ここの画像が消える。1回押せば済む作業なので、派手な警告は出さず、
 * 残っているあいだだけ静かに1行置く。
 */
function AdoptImages({ count }: { count: number }) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setRunning(true)
    setError(null)

    const res = await fetch('/api/favorites/adopt-images', { method: 'POST' }).catch(() => null)
    const body = await res?.json().catch(() => null)

    setRunning(false)
    if (!res?.ok) {
      setError(body?.error ?? '取り込めませんでした')
      return
    }
    // 1枚も移せなかったときは、押しても何も変わらないので理由を出す
    if (body?.moved === 0) {
      setError(body?.error ?? 'Drive から読めませんでした。共有の設定をご確認ください')
      return
    }
    router.refresh()
  }

  return (
    <div>
      <Button
        full
        className="!min-h-[40px] !text-[12px]"
        onClick={withTapFeedback(() => void run())}
        disabled={running}
      >
        {running ? '取り込み中…' : `Drive の画像をアプリに取り込む（${count}件）`}
      </Button>
      {error ? <p className="mt-1.5 text-[11px] text-danger">{error}</p> : null}
    </div>
  )
}
