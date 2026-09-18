'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Button,
  Card,
  Chip,
  EmptyState,
  IconButton,
  IconFrame,
  PillTabs,
  Segmented,
  inputClassCompact,
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
import { parseTakeoutPlaces } from '@/lib/csv'
import {
  PLACE_KINDS,
  filterByGenre,
  filterByKind,
  genresOf,
  mapsUrl,
  placeKindLabel,
  searchPlaces,
  splitPlaces,
} from '@/lib/places'
import {
  CLOSED_FILTER,
  filterClosed,
  isClosed,
  statusLabel,
} from '@/lib/places-status'
import { shortDate, today } from '@/lib/format'
import { tapFeedback } from '@/lib/haptics'
import type { Place, PlaceGenre, PlaceKind } from '@/types'

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

type Tab = 'all' | 'wish' | 'visited'
type KindTab = 'all' | PlaceKind

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'すべて' },
  { id: 'wish', label: '行きたい' },
  { id: 'visited', label: '行った' },
]

/** 1回に座標を引く件数。上限に一度で当たらないようにする */
const LOCATE_STEP = 20

const KIND_TABS: { id: KindTab; label: string }[] = [
  { id: 'all', label: 'すべて' },
  { id: 'sight', label: '観光地' },
  { id: 'food', label: '飲食' },
]

/**
 * ジャンル、または「閉店」で絞る。
 *
 * 「閉店」はジャンルの並びに置いてあるが、ジャンルの言葉ではない（0045）。
 * 選ばれたときだけ、状態のほうで絞る。
 */
function narrowBy(rows: Place[], genre: string | null): Place[] {
  return genre === CLOSED_FILTER ? filterClosed(rows) : filterByGenre(rows, genre)
}

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
  const closed = isClosed(place)
  const closedLabel = statusLabel(place.business_status)

  return (
    <Card className={`!p-3.5${closed ? ' opacity-70' : ''}`}>
      <div className="flex items-start gap-3">
        <IconFrame tone={visited && !closed ? 'marine' : 'default'}>
          {place.kind === 'food' ? <IconFood size={17} /> : <IconCamera size={17} />}
        </IconFrame>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-fg-mute">
            <span className="shrink-0">
              {placeKindLabel(place.kind)}
              {place.genre ? ` / ${place.genre}` : ''}
            </span>
            {place.area ? <span className="truncate">{place.area}</span> : null}
            {visited ? (
              <span className="tnum shrink-0 text-marine">{shortDate(place.visited_on!)}</span>
            ) : null}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className={`truncate text-sm${closed ? ' text-fg-mute line-through' : ''}`}>
              {place.name}
            </span>
            {closedLabel ? (
              <span className="shrink-0 rounded-full border border-danger/50 px-2 py-0.5 text-[10px] text-danger">
                {closedLabel}
              </span>
            ) : null}
          </div>
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
        {/* 行った／行きたいの切り替え。言葉は「行った」だけにして、
            押してあるかどうかは色で出す。もう一度押すと戻る */}
        <button
          type="button"
          disabled={busy}
          aria-pressed={visited}
          title={visited ? '行った（押すと行きたいに戻ります）' : '行ったことにする'}
          onClick={() => onToggleVisited(place)}
          className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-[11px] transition-colors disabled:opacity-40 ${
            visited
              ? 'border-marine/60 bg-marine/12 text-marine'
              : 'border-line text-fg-mute hover:border-marine/50 hover:text-marine'
          }`}
        >
          行った
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
  genreOptions,
}: {
  userId: string
  places: Place[]
  /** 飲食のジャンルの候補。設定画面で足せる */
  genreOptions: PlaceGenre[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('all')
  const [kind, setKind] = useState<KindTab>('all')
  const [genre, setGenre] = useState<string | null>(null)
  const [words, setWords] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<{ place: Place | null } | null>(null)

  // まとめて座標を引いているあいだの進み具合
  const [locating, setLocating] = useState(false)
  const [locateNote, setLocateNote] = useState<string | null>(null)

  // 保存リストの取り込み
  const [importKind, setImportKind] = useState<PlaceKind>('food')
  const [importing, setImporting] = useState(false)
  const [importNote, setImportNote] = useState<string | null>(null)

  const lists = useMemo(() => splitPlaces(places), [places])

  /** 種別で絞ったぶん。ジャンルの選択肢はここから作る */
  const byKind = useMemo(() => {
    // 「すべて」は行きたいを先に出す。これから行く場所のほうを上に置きたい
    const rows =
      tab === 'all' ? [...lists.wish, ...lists.visited] : tab === 'wish' ? lists.wish : lists.visited
    return filterByKind(rows, kind === 'all' ? null : kind)
  }, [lists, tab, kind])

  /** いま出ている場所に実際に入っているジャンルだけを、設定した順に出す */
  const genres = useMemo(
    () => genresOf(byKind, genreOptions.map((g) => g.name)),
    [byKind, genreOptions]
  )

  /** 閉店・休業の数。0 なら「閉店」の絞り込みも出さない */
  const closedCount = useMemo(() => filterClosed(byKind).length, [byKind])

  const shown = useMemo(
    () => searchPlaces(narrowBy(byKind, genre), words),
    [byKind, genre, words]
  )

  /** 地図に出すぶん。タブでは絞らず、種別・ジャンル・言葉で絞る */
  const onMap = useMemo(
    () =>
      searchPlaces(
        narrowBy(filterByKind(places, kind === 'all' ? null : kind), genre),
        words
      ),
    [places, kind, genre, words]
  )

  /** 地図に出ていない場所。座標を引けていないもの */
  const unlocated = useMemo(() => places.filter((p) => p.lat === null || p.lng === null), [places])

  /**
   * 地図に出ていない場所の座標をまとめて引く。
   *
   * 1回に引くのは20件まで。上限（100件/日）に一度で当たらないようにし、
   * 押しっぱなしで延々と呼ばないようにする。引けなかった場所は
   * そのまま残るので、名前や場所を直してから押し直せばよい。
   */
  const locateAll = async () => {
    if (unlocated.length === 0) return

    tapFeedback()
    setLocating(true)
    setLocateNote(null)

    const targets = unlocated.slice(0, LOCATE_STEP)
    let done = 0
    let overBudget = false

    for (const place of targets) {
      const res = await fetch('/api/places/geocode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: place.id }),
      }).catch(() => null)

      if (res?.status === 429) {
        overBudget = true
        break
      }
      const body = res?.ok ? ((await res.json()) as { ok?: boolean }) : null
      if (body?.ok) done += 1
    }

    setLocating(false)
    setLocateNote(
      overBudget
        ? `今日はここまでです（${done} 件取り込みました）。明朝また押してください。`
        : `${done} / ${targets.length} 件の位置を取り込みました。` +
          (targets.length < unlocated.length
            ? ` 残り ${unlocated.length - targets.length} 件は、もう一度押してください。`
            : '')
    )
    router.refresh()
  }

  /**
   * Google マップの保存リスト（Takeout の CSV）を取り込む。
   *
   * 保存リストを読む API は公開されていないので、書き出したファイルを
   * 読むしかない。取り込むのは名前とメモだけで、座標はあとから
   * 「位置をまとめて取り込む」で引く。1件ずつ引くと、大きなリストで
   * 上限に当たって途中で止まるため。
   *
   * すでに同じ名前がある場所は入れない。何度読ませても増えない。
   */
  const importList = async (file: File) => {
    setImporting(true)
    setImportNote(null)

    const rows = parseTakeoutPlaces(await file.text())
    if (rows.length === 0) {
      setImporting(false)
      setImportNote('読み取れませんでした。Takeout の保存済みリストの CSV を選んでください。')
      return
    }

    const known = new Set(places.map((p) => p.name))
    const fresh = rows.filter((row) => !known.has(row.name))

    if (fresh.length === 0) {
      setImporting(false)
      setImportNote(`${rows.length} 件すべて、すでに入っています。`)
      return
    }

    const supabase = createClient()
    const { error: saveError } = await supabase.from('places').insert(
      fresh.map((row) => ({
        kind: importKind,
        name: row.name,
        area: '',
        genre: '',
        url: row.url,
        note: row.note,
        created_by: userId,
      }))
    )

    setImporting(false)
    if (saveError) {
      setImportNote('取り込めませんでした。')
      return
    }

    setImportNote(
      `${fresh.length} 件を取り込みました。` +
        (rows.length > fresh.length ? `（${rows.length - fresh.length} 件は登録済み）` : '') +
        ' 地図に出すには「位置をまとめて取り込む」を押してください。'
    )
    router.refresh()
  }

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
        <Button variant="primary" full className="mt-3" onClick={() => setSheet({ place: null })}>
          <span className="flex items-center justify-center gap-2">
            <IconPlus size={17} />
            行きたい場所を追加
          </span>
        </Button>
        <Link
          href="/places/genres"
          prefetch={false}
          className="mt-2 block text-center text-[11px] text-fg-mute underline underline-offset-2 transition-colors hover:text-marine"
        >
          飲食のジャンルを編集
        </Link>
      </Card>

      <Segmented value={tab} options={TABS} onChange={setTab} />
      <Segmented value={kind} options={KIND_TABS} onChange={setKind} />

      {/* ジャンル。登録されている言葉だけを出す（観光地にジャンルは無い）。
          閉店した店があるときだけ、並びの最後に「閉店」を足す */}
      {kind !== 'sight' && (genres.length > 0 || closedCount > 0) ? (
        <PillTabs
          value={genre ?? ''}
          options={[
            { id: '', label: 'ジャンル問わず' },
            ...genres.map((g) => ({ id: g, label: g })),
            ...(closedCount > 0
              ? [{ id: CLOSED_FILTER, label: `閉店 ${closedCount}` }]
              : []),
          ]}
          onChange={(id) => setGenre(id === '' ? null : id)}
        />
      ) : null}

      <input
        className={inputClassCompact}
        value={words}
        onChange={(e) => setWords(e.target.value)}
        placeholder="名前・場所・メモで探す"
      />

      {/* 地図は行きたい・行った の両方を出す。塗り分けで見分けられるので、
          片方だけにすると「近くに行った店がある」が見えなくなる。
          種別の絞り込みは効かせる */}
      <PlacesMap places={onMap} />

      {/* 地図に出ていない場所。あとから地図を使えるようにしたぶんを拾う */}
      {unlocated.length > 0 ? (
        <Card>
          <p className="text-[13px]">
            地図に出ていない場所が {unlocated.length} 件あります。
          </p>
          <Button
            variant="outline"
            full
            className="mt-3"
            disabled={locating}
            onClick={locateAll}
          >
            {locating ? '取り込んでいます' : '位置をまとめて取り込む'}
          </Button>
          {locateNote ? (
            <p className="mt-2 text-[11px] leading-relaxed text-fg-mute">{locateNote}</p>
          ) : null}
        </Card>
      ) : null}

      {error ? <p className="text-[13px] text-danger">{error}</p> : null}

      {shown.length === 0 ? (
        <EmptyState
          title={
            tab === 'visited' ? '行った場所がまだありません' : '行きたい場所がまだありません'
          }
          description={
            tab === 'visited'
              ? '行きたい場所で「行った」を押すと、こちらに移ります。'
              : '観光地や店を思い付いたときに足しておくと、遠征のときに迷いません。'
          }
        />
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

      {/* Google マップの保存リストの取り込み。初回の引っ越し用なので一番下 */}
      <details className="glass rounded-2xl px-4 py-3">
        <summary className="cursor-pointer text-[13px] text-fg-dim">
          Google マップの保存リストを取り込む
        </summary>
        <p className="mt-3 text-[11px] leading-relaxed text-fg-mute">
          Google Takeout で「マップ（あなたの地図）」の保存済みリストを書き出し、
          その CSV を選んでください。取り込むのは名前とメモだけで、
          位置はあとから「位置をまとめて取り込む」で引きます。
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {PLACE_KINDS.map((k) => (
            <Chip key={k} selected={importKind === k} onClick={() => setImportKind(k)}>
              {placeKindLabel(k)}として取り込む
            </Chip>
          ))}
        </div>

        <label className="mt-3 flex min-h-[44px] w-full cursor-pointer items-center justify-center rounded-xl border border-dashed border-line px-4 text-[13px] text-fg-dim transition-colors hover:border-marine/50 hover:text-marine">
          {importing ? '取り込んでいます' : 'CSV を選ぶ'}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={importing}
            onChange={(e) => {
              const file = e.target.files?.[0]
              // 同じファイルを続けて選べるようにする
              e.target.value = ''
              if (file) void importList(file)
            }}
          />
        </label>

        {importNote ? (
          <p className="mt-2 text-[11px] leading-relaxed text-fg-mute">{importNote}</p>
        ) : null}
      </details>

      {sheet ? (
        <PlaceSheet
          place={sheet.place}
          genres={genreOptions}
          userId={userId}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </div>
  )
}
