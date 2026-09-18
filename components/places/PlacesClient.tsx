'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  IconFrame,
  SectionLabel,
  Segmented,
} from '@/components/ui'
import {
  IconCamera,
  IconEdit,
  IconExternal,
  IconFood,
  IconPlus,
  IconTrash,
} from '@/components/icons'
import PlaceSheet from '@/components/places/PlaceSheet'
import PlacesMap from '@/components/places/PlacesMap'
import { createClient } from '@/lib/supabase/client'
import {
  filterByKind,
  groupByStadium,
  mapsUrl,
  placeKindLabel,
  splitPlaces,
} from '@/lib/places'
import { shortDate, today } from '@/lib/format'
import { tapFeedback } from '@/lib/haptics'
import type { Place, PlaceKind } from '@/types'

/**
 * 行きたい場所と、行った場所。
 *
 * 遠征は球場だけで終わらない。思い付いたときに書き留めておき、行ったら
 * 「行った」を押して、行った場所のリストへ移す。表は1つで、行った日が
 * 入っているかどうかで分かれる（0040）。書き写さないので、行きたい側で
 * 書いたメモがそのまま残る。
 *
 * 地図は Google マップへのリンクで開く。鍵も課金も要らない公式の形で、
 * スマートフォンではアプリが開く。
 */

type Tab = 'wish' | 'visited'
type KindTab = 'all' | PlaceKind

const TABS: { id: Tab; label: string }[] = [
  { id: 'wish', label: '行きたい' },
  { id: 'visited', label: '行った' },
]

const KIND_TABS: { id: KindTab; label: string }[] = [
  { id: 'all', label: 'すべて' },
  { id: 'sight', label: '観光地' },
  { id: 'food', label: '飲食' },
]

function PlaceCard({
  place,
  busy,
  onToggleVisited,
  onEdit,
  onDelete,
}: {
  place: Place
  busy: boolean
  onToggleVisited: (place: Place) => void
  onEdit: (place: Place) => void
  onDelete: (place: Place) => void
}) {
  const visited = Boolean(place.visited_on)

  return (
    <Card className="!p-3.5">
      <div className="flex items-start gap-3">
        <IconFrame tone={visited ? 'marine' : 'default'}>
          {place.kind === 'food' ? <IconFood size={17} /> : <IconCamera size={17} />}
        </IconFrame>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-fg-mute">
            <span>{placeKindLabel(place.kind)}</span>
            {place.area ? <span className="truncate">{place.area}</span> : null}
            {visited ? (
              <span className="tnum shrink-0 text-marine">{shortDate(place.visited_on!)}</span>
            ) : null}
          </div>
          <div className="mt-1 truncate text-sm">{place.name}</div>
          {place.note ? (
            <p className="mt-1 truncate text-[11px] text-fg-mute">{place.note}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 gap-1.5">
          <IconButton label="編集" onClick={() => onEdit(place)}>
            <IconEdit size={15} />
          </IconButton>
          <IconButton
            label="削除"
            onClick={() => onDelete(place)}
            className="hover:border-danger/50 hover:text-danger"
          >
            <IconTrash size={15} />
          </IconButton>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => onToggleVisited(place)}
          className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-[11px] transition-colors disabled:opacity-40 ${
            visited
              ? 'border-marine/60 bg-marine/12 text-marine'
              : 'border-line text-fg-mute hover:border-marine/50 hover:text-marine'
          }`}
        >
          {visited ? '行った' : '行ったことにする'}
        </button>

        <a
          href={mapsUrl(place)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-fg-mute underline underline-offset-2 transition-colors hover:text-marine"
        >
          地図で開く
          <IconExternal size={12} />
        </a>

        {place.url ? (
          <a
            href={place.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 truncate text-[11px] text-fg-mute underline underline-offset-2 transition-colors hover:text-marine"
          >
            リンク
            <IconExternal size={12} />
          </a>
        ) : null}
      </div>
    </Card>
  )
}

export default function PlacesClient({
  userId,
  places,
}: {
  userId: string
  places: Place[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('wish')
  const [kind, setKind] = useState<KindTab>('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<{ place: Place | null } | null>(null)

  const lists = useMemo(() => splitPlaces(places), [places])
  const shown = useMemo(
    () => filterByKind(tab === 'wish' ? lists.wish : lists.visited, kind === 'all' ? null : kind),
    [lists, tab, kind]
  )

  /** 地図に出すぶん。タブでは絞らず、種別だけで絞る */
  const onMap = useMemo(
    () => filterByKind(places, kind === 'all' ? null : kind),
    [places, kind]
  )

  /** 球場ごとにまとめるのは「行きたい」側だけ。遠征の計画に使う */
  const groups = useMemo(() => (tab === 'wish' ? groupByStadium(shown) : []), [shown, tab])

  /** 行った／行きたいを行き来する。日付を入れるだけで、メモは残る */
  const toggleVisited = async (place: Place) => {
    tapFeedback()
    setBusy(true)
    setError(null)

    const supabase = createClient()
    const { error: saveError } = await supabase
      .from('places')
      .update({ visited_on: place.visited_on ? null : today() })
      .eq('id', place.id)

    setBusy(false)
    if (saveError) {
      setError('記録できませんでした')
      return
    }
    router.refresh()
  }

  const remove = async (place: Place) => {
    if (!window.confirm(`「${place.name}」を消しますか？（メンバー全員から消えます）`)) return
    setBusy(true)
    const supabase = createClient()
    await supabase.from('places').delete().eq('id', place.id)
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="glow">
        <div className="eyebrow">行きたい / 行った</div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="tnum text-[42px] font-semibold leading-none text-marine">
            {lists.visited.length}
          </span>
          <span className="text-lg text-fg-mute">/ {places.length} 件</span>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-fg-mute">
          行きたい場所は {lists.wish.length} 件あります。
          リストはメンバー全員で共有していて、誰でも足せます。
        </p>
        <Button variant="primary" full className="mt-3" onClick={() => setSheet({ place: null })}>
          <span className="flex items-center justify-center gap-2">
            <IconPlus size={17} />
            行きたい場所を追加
          </span>
        </Button>
      </Card>

      <Segmented value={tab} options={TABS} onChange={setTab} />
      <Segmented value={kind} options={KIND_TABS} onChange={setKind} />

      {/* 地図は行きたい・行った の両方を出す。塗り分けで見分けられるので、
          片方だけにすると「近くに行った店がある」が見えなくなる。
          種別の絞り込みは効かせる */}
      <PlacesMap places={onMap} />

      {error ? <p className="text-[13px] text-danger">{error}</p> : null}

      {shown.length === 0 ? (
        <EmptyState
          title={tab === 'wish' ? '行きたい場所がまだありません' : '行った場所がまだありません'}
          description={
            tab === 'wish'
              ? '観光地や店を思い付いたときに足しておくと、遠征のときに迷いません。'
              : '行きたい場所で「行ったことにする」を押すと、こちらに移ります。'
          }
        />
      ) : tab === 'wish' ? (
        groups.map((group) => (
          <div key={group.label}>
            <SectionLabel>{group.label}</SectionLabel>
            <div className="flex flex-col gap-2">
              {group.places.map((place) => (
                <PlaceCard
                  key={place.id}
                  place={place}
                  busy={busy}
                  onToggleVisited={toggleVisited}
                  onEdit={(p) => setSheet({ place: p })}
                  onDelete={remove}
                />
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((place) => (
            <PlaceCard
              key={place.id}
              place={place}
              busy={busy}
              onToggleVisited={toggleVisited}
              onEdit={(p) => setSheet({ place: p })}
              onDelete={remove}
            />
          ))}
        </div>
      )}

      {sheet ? (
        <PlaceSheet place={sheet.place} userId={userId} onClose={() => setSheet(null)} />
      ) : null}
    </div>
  )
}
