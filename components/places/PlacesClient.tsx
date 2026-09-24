'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Button,
  Card,
  Chip,
  EmptyState,
  IconButton,
  IconFrame,
} from '@/components/ui'
import {
  IconCamera,
  IconClose,
  IconEdit,
  IconExternal,
  IconFood,
  IconMap,
  IconPlus,
  IconRules,
  IconSearch,
  IconTrash,
} from '@/components/icons'
import PlaceSheet from '@/components/places/PlaceSheet'
import PlacesMap from '@/components/places/PlacesMap'
import { createClient } from '@/lib/supabase/client'
import { parseTakeoutPlaces } from '@/lib/csv'
import {
  PLACE_KINDS,
  REVISIT_CHOICES,
  REVISIT_LABEL,
  filterByGenres,
  filterByIngredients,
  filterByKind,
  genresOf,
  ingredientsOf,
  mapsUrl,
  placeKindLabel,
  revisitPatch,
  searchPlaces,
  splitPlaces,
  toggleTag,
} from '@/lib/places'
import { filterClosed, isClosed, statusLabel } from '@/lib/places-status'
import { today } from '@/lib/format'
import { tapFeedback } from '@/lib/haptics'
import type { Place, PlaceGenre, PlaceKind, Revisit } from '@/types'

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

/** 1回に座標を引く件数。上限に一度で当たらないようにする */
const LOCATE_STEP = 20

/**
 * 1回に種別・ジャンルを取り込む件数（0051）。
 *
 * places_search の上限は1日50回で、閉店の確認が毎朝5回使う。残りから
 * 余裕を見て10件にしてある。30件あっても3回押せば終わる。
 */
const CLASSIFY_STEP = 10

/**
 * 絞り込みの条件。軸ごとに別々に持つ。
 *
 * ひとつの値で持っていたころは、ジャンルと食材が同じ場所に入っていたため
 * 「焼肉」と「牛」を同時に選べなかった。軸を分けると、掛け合わせて絞れる。
 * 同じ軸の中は「どれか」、軸どうしは「かつ」で効く。
 */
type Filters = {
  genres: string[]
  ingredients: string[]
  /** 閉店・休業だけを見る（0045） */
  closedOnly: boolean
}

const NO_FILTERS: Filters = { genres: [], ingredients: [], closedOnly: false }

function narrowBy(rows: Place[], f: Filters): Place[] {
  const out = filterByIngredients(filterByGenres(rows, f.genres), f.ingredients)
  return f.closedOnly ? filterClosed(out) : out
}

/** いくつ絞り込んでいるか。0 なら「解除」を出さない */
function activeCount(f: Filters, kind: KindTab, tab: Tab): number {
  return (
    f.genres.length +
    f.ingredients.length +
    (f.closedOnly ? 1 : 0) +
    (kind === 'all' ? 0 : 1) +
    (tab === 'all' ? 0 : 1)
  )
}

/**
 * 数と絞り込みを兼ねるボタン。
 *
 * 数を見せる場所と「行きたいだけ見る」を押す場所は同じでよい。別々に
 * 置くと、数の行と札の行で2段になる。押すと絞り込み、もう一度押すと戻る。
 */
function CountTab({
  n,
  label,
  on,
  onClick,
}: {
  n: number
  label: string
  on: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => {
        tapFeedback()
        onClick()
      }}
      className={`flex h-10 shrink-0 items-baseline gap-1.5 rounded-xl border px-2.5 transition-colors ${
        on
          ? 'border-marine/60 bg-marine/12'
          : 'border-transparent hover:border-line'
      }`}
    >
      <span
        className={`tnum text-[20px] font-semibold leading-[38px] ${
          on ? 'text-marine' : 'text-fg'
        }`}
      >
        {n}
      </span>
      <span
        className={`whitespace-nowrap text-[10.5px] leading-[38px] ${
          on ? 'text-marine' : 'text-fg-mute'
        }`}
      >
        {label}
      </span>
    </button>
  )
}

type FilterItem = { id: string; label: string; on: boolean; onToggle: () => void }

/**
 * 1段に束ねた絞り込み（案B）。
 *
 * 種別・ジャンル・食材を、区切りを挟んだ横1列に並べる。段を分けて
 * 積み上げると、画面の上半分がすべて絞り込みで埋まり、地図と一覧が下に
 * 押し出される。1列なら、使うぶんだけ横へ送れる。
 */
function FilterRow({
  groups,
  active,
  onClear,
}: {
  groups: { name: string; items: FilterItem[] }[]
  active: number
  onClear: () => void
}) {
  return (
    <div className="-mx-4 flex items-center gap-2 px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
        {groups.map((group, index) => (
          <Fragment key={group.name}>
            {index > 0 ? (
              <span aria-hidden="true" className="h-5 w-px shrink-0 bg-line" />
            ) : null}
            <div
              role="group"
              aria-label={group.name}
              className="flex shrink-0 items-center gap-2"
            >
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={item.on}
                  onClick={() => {
                    tapFeedback()
                    item.onToggle()
                  }}
                  className={`min-h-[38px] shrink-0 rounded-full border px-4 text-[13px] transition-colors ${
                    item.on
                      ? 'border-marine/70 bg-marine/12 text-marine font-medium shadow-[0_0_26px_-14px_rgba(34,211,238,0.9)]'
                      : 'border-line text-fg-mute hover:text-fg-dim'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </Fragment>
        ))}
      </div>

      {/* いくつ絞り込んでいるか。横へ送ると押した札が画面から出てしまうので、
          ここは流さずに置く。数だけでも見えていれば、絞り込み中だと分かる */}
      {active > 0 ? (
        <>
          <span aria-hidden="true" className="h-5 w-px shrink-0 bg-line" />
          <span
            aria-hidden="true"
            className="tnum shrink-0 rounded-full bg-marine/15 px-2 py-0.5 text-[11px] text-marine"
          >
            {active}
          </span>
          <button
            type="button"
            aria-label={`絞り込み ${active} 件を解除`}
            onClick={() => {
              tapFeedback()
              onClear()
            }}
            className="min-h-[38px] shrink-0 text-[12px] text-fg-mute underline underline-offset-2 transition-colors hover:text-marine"
          >
            解除
          </button>
        </>
      ) : null}
    </div>
  )
}

function PlaceCard({
  place,
  busy,
  onChooseRevisit,
  onEdit,
  onDelete,
}: {
  place: Place
  busy: boolean
  onChooseRevisit: (place: Place, choice: Exclude<Revisit, ''>) => void
  onEdit: (place: Place) => void
  onDelete: (place: Place) => void
}) {
  const visited = Boolean(place.visited_on)
  const closed = isClosed(place)
  const closedLabel = statusLabel(place.business_status)

  /** 種別・ジャンル・食材・場所を1行にまとめる。札を増やすと行が増える */
  const meta = [
    placeKindLabel(place.kind),
    ...place.genres,
    ...place.ingredients,
    place.area,
  ].filter(Boolean)

  return (
    <Card className={`!p-3${closed ? ' opacity-70' : ''}`}>
      <div className="flex items-start gap-2.5">
        <IconFrame tone={visited && !closed ? 'marine' : 'default'}>
          {place.kind === 'food' ? <IconFood size={16} /> : <IconCamera size={16} />}
        </IconFrame>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`truncate text-sm${closed ? ' text-fg-mute line-through' : ''}`}>
              {place.name}
            </span>
            {closedLabel ? (
              <span className="shrink-0 rounded-md border border-danger/50 px-1.5 text-[10px] leading-[17px] text-danger">
                {closedLabel}
              </span>
            ) : null}
          </div>

          <p className="mt-0.5 truncate text-[11px] text-fg-mute">
            {meta.join(' ・ ')}
            {place.note ? ` — ${place.note}` : ''}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2 border-t border-line-soft pt-2.5">
        {/* リピあり・リピなし。どちらかを押すと行った扱いになる。
            同じ札をもう一度押すと行きたいへ戻る */}
        {REVISIT_CHOICES.map((choice) => {
          const on = place.revisit === choice
          const tone =
            choice === 'yes'
              ? 'border-marine/60 bg-marine/12 text-marine'
              : 'border-fg-mute/60 bg-fg-mute/15 text-fg-dim'
          return (
            <button
              key={choice}
              type="button"
              disabled={busy}
              aria-pressed={on}
              title={on ? `${REVISIT_LABEL[choice]}（押すと行きたいに戻ります）` : REVISIT_LABEL[choice]}
              onClick={() => onChooseRevisit(place, choice)}
              className={`inline-flex h-8 items-center rounded-full border px-3 text-[11px] transition-colors disabled:opacity-40 ${
                on ? tone : 'border-line text-fg-mute hover:border-marine/50 hover:text-marine'
              }`}
            >
              {REVISIT_LABEL[choice]}
            </button>
          )
        })}

        {/* 開く・直す・消すは印だけにする。言葉で並べると2行になる */}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <a
            href={mapsUrl(place)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="地図で開く"
            title="地図で開く"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line text-fg-mute transition-colors hover:border-marine/50 hover:text-marine"
          >
            <IconMap size={15} />
          </a>

          {place.url ? (
            <a
              href={place.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="リンクを開く"
              title="リンクを開く"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line text-fg-mute transition-colors hover:border-marine/50 hover:text-marine"
            >
              <IconExternal size={14} />
            </a>
          ) : null}

          <IconButton label="編集" className="!h-8 !w-8" onClick={() => onEdit(place)}>
            <IconEdit size={14} />
          </IconButton>
          <IconButton
            label="削除"
            className="!h-8 !w-8 hover:border-danger/50 hover:text-danger"
            onClick={() => onDelete(place)}
          >
            <IconTrash size={14} />
          </IconButton>
        </div>
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
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [words, setWords] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<{ place: Place | null } | null>(null)

  // まとめて座標を引いているあいだの進み具合
  const [locating, setLocating] = useState(false)
  const [locateNote, setLocateNote] = useState<string | null>(null)

  // 種別・ジャンルの取り込み
  const [classifying, setClassifying] = useState(false)
  const [classifyNote, setClassifyNote] = useState<string | null>(null)

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

  /** 候補をジャンルと食材に分ける。並びは設定画面で決めた順 */
  const tagOrder = useMemo(
    () => ({
      genre: genreOptions.filter((g) => g.kind !== 'ingredient').map((g) => g.name),
      ingredient: genreOptions.filter((g) => g.kind === 'ingredient').map((g) => g.name),
    }),
    [genreOptions]
  )

  /** いま出ている場所に実際に入っているジャンル・食材だけを出す */
  const genreChoices = useMemo(() => genresOf(byKind, tagOrder.genre), [byKind, tagOrder])
  const ingredientChoices = useMemo(
    () => ingredientsOf(byKind, tagOrder.ingredient),
    [byKind, tagOrder]
  )

  /** 閉店・休業の数。0 なら「閉店」の絞り込みも出さない */
  const closedCount = useMemo(() => filterClosed(byKind).length, [byKind])

  const shown = useMemo(
    () => searchPlaces(narrowBy(byKind, filters), words),
    [byKind, filters, words]
  )

  /** 地図に出すぶん。タブでは絞らず、種別・絞り込み・言葉で絞る */
  const onMap = useMemo(
    () =>
      searchPlaces(
        narrowBy(filterByKind(places, kind === 'all' ? null : kind), filters),
        words
      ),
    [places, kind, filters, words]
  )

  /**
   * 種別を選び直す。同じものをもう一度押したら「すべて」に戻す。
   *
   * 観光地にはジャンルも食材も無い（0044 / 0049）。
   * 選んだまま観光地へ移ると、当たる場所が1つも無くなる。外しておく。
   */
  const chooseKind = (next: PlaceKind) => {
    const value = kind === next ? 'all' : next
    setKind(value)
    if (value === 'sight') {
      setFilters((f) => ({ ...f, genres: [], ingredients: [] }))
    }
  }

  /** 飲食の軸。観光地だけを見ているときは出さない */
  const foodAxes = kind !== 'sight'

  /** 表示を選び直す。同じものをもう一度押したら「すべて」に戻す */
  const chooseTab = (next: Exclude<Tab, 'all'>) => setTab(tab === next ? 'all' : next)

  const filterGroups = [
    {
      name: '種別',
      items: PLACE_KINDS.map((k) => ({
        id: k,
        label: placeKindLabel(k),
        on: kind === k,
        onToggle: () => chooseKind(k),
      })),
    },
    ...(foodAxes && genreChoices.length > 0
      ? [
          {
            name: 'ジャンル',
            items: genreChoices.map((name) => ({
              id: name,
              label: name,
              on: filters.genres.includes(name),
              onToggle: () =>
                setFilters((f) => ({ ...f, genres: toggleTag(f.genres, name) })),
            })),
          },
        ]
      : []),
    ...(foodAxes && ingredientChoices.length > 0
      ? [
          {
            name: '食材',
            items: ingredientChoices.map((name) => ({
              id: name,
              label: name,
              on: filters.ingredients.includes(name),
              onToggle: () =>
                setFilters((f) => ({ ...f, ingredients: toggleTag(f.ingredients, name) })),
            })),
          },
        ]
      : []),
    ...(closedCount > 0
      ? [
          {
            name: '状態',
            items: [
              {
                id: 'closed',
                label: `閉店 ${closedCount}`,
                on: filters.closedOnly,
                onToggle: () => setFilters((f) => ({ ...f, closedOnly: !f.closedOnly })),
              },
            ],
          },
        ]
      : []),
  ]

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

  /** まだ Google に種別・ジャンルを聞いていない場所 */
  const unclassified = useMemo(
    () => places.filter((p) => p.types_checked_at === null),
    [places]
  )

  /**
   * 種別とジャンルを Google からまとめて取り込む（0051）。
   *
   * 保存リストの取り込みでは「全部まとめて飲食」としか入れられず、観光地も
   * 飲食に混ざる。ジャンルも空のままになる。1件ずつ直すのは続かない。
   *
   * 1回に10件まで。上限に当たったらそこで止める。押し直せば続きから進む。
   */
  const classifyAll = async () => {
    if (unclassified.length === 0) return

    tapFeedback()
    setClassifying(true)
    setClassifyNote(null)

    const targets = unclassified.slice(0, CLASSIFY_STEP)
    let done = 0
    let overBudget = false

    for (const place of targets) {
      const res = await fetch('/api/places/classify', {
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

    setClassifying(false)
    const rest = unclassified.length - targets.length
    setClassifyNote(
      overBudget
        ? `今日はここまでです（${done} 件わかりました）。明日また押してください。`
        : `${done} / ${targets.length} 件わかりました。` +
          (rest > 0 ? ` 残り ${rest} 件は、もう一度押してください。` : '')
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

  /**
   * リピあり・リピなしを付ける。
   *
   * まだ行っていない場所に押したときは、その日を行った日として入れる。
   * 押してある札をもう一度押すと行きたい側へ戻る。どちらもメモは残る。
   */
  const chooseRevisit = async (place: Place, choice: Exclude<Revisit, ''>) => {
    tapFeedback()
    setBusy(true)
    setError(null)

    const supabase = createClient()
    const { error: saveError } = await supabase
      .from('places')
      .update(revisitPatch(place, choice, today()))
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
    <div className="flex flex-col gap-3.5">
      {/* 数と操作を1本のバーに収める。大きな数字と全幅のボタンで3段を使うと、
          地図と一覧が画面の外へ出ていた */}
      <div className="glass glow flex items-center gap-3 rounded-2xl px-4 py-2.5">
        <div role="group" aria-label="表示" className="flex flex-1 items-center gap-1">
          <CountTab
            n={lists.wish.length}
            label="行きたい"
            on={tab === 'wish'}
            onClick={() => chooseTab('wish')}
          />
          <CountTab
            n={lists.visited.length}
            label="行った"
            on={tab === 'visited'}
            onClick={() => chooseTab('visited')}
          />
        </div>

        <Link
          href="/places/genres"
          prefetch={false}
          aria-label="飲食のジャンルを編集"
          title="飲食のジャンルを編集"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line text-fg-mute transition-colors hover:border-marine/50 hover:text-marine"
        >
          <IconRules size={16} />
        </Link>

        <button
          type="button"
          aria-label="行きたい場所を追加"
          title="行きたい場所を追加"
          onClick={() => {
            tapFeedback()
            setSheet({ place: null })
          }}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-marine px-2.5 text-[13px] font-semibold text-ink transition-opacity hover:opacity-90 min-[360px]:px-3"
        >
          <IconPlus size={16} />
          {/* 狭い画面では字を落とす。数の札が「行..」と潰れるのを防ぐ */}
          <span className="hidden min-[360px]:inline">追加</span>
        </button>
      </div>

      {/* 種別・ジャンル・食材を1段に束ねる（案B）。
          押したものだけが効き、同じものをもう一度押すと外れる */}
      <FilterRow
        groups={filterGroups}
        active={activeCount(filters, kind, tab)}
        onClear={() => {
          setTab('all')
          setKind('all')
          setFilters(NO_FILTERS)
        }}
      />

      {/* 文字の大きさは 16px のままにする。小さくすると iOS で
          入力のたびに画面が拡大する */}
      <label className="glass flex h-12 items-center gap-2.5 rounded-full px-4">
        <span className="shrink-0 text-fg-mute">
          <IconSearch size={17} />
        </span>
        <input
          className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-mute"
          value={words}
          onChange={(e) => setWords(e.target.value)}
          placeholder="名前・場所・メモで探す"
          aria-label="名前・場所・メモで探す"
        />
        {words ? (
          <button
            type="button"
            aria-label="入力を消す"
            onClick={() => setWords('')}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-fg-mute transition-colors hover:border-marine/50 hover:text-marine"
          >
            <IconClose size={13} />
          </button>
        ) : null}
      </label>

      {/* 地図は行きたい・行った の両方を出す。塗り分けで見分けられるので、
          片方だけにすると「近くに行った店がある」が見えなくなる。
          種別の絞り込みは効かせる */}
      <PlacesMap places={onMap} />

      {/* 種別・ジャンルがまだのもの。保存リストから入れたぶんを拾う */}
      {unclassified.length > 0 ? (
        <Card>
          <p className="text-[13px]">
            種別・ジャンルがまだの場所が {unclassified.length} 件あります。
          </p>
          <Button
            variant="outline"
            full
            className="mt-3"
            disabled={classifying}
            onClick={classifyAll}
          >
            {classifying ? '取り込んでいます' : '種別・ジャンルをまとめて取り込む'}
          </Button>
          {classifyNote ? (
            <p className="mt-2 text-[11px] leading-relaxed text-fg-mute">{classifyNote}</p>
          ) : null}
        </Card>
      ) : null}

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
              ? '行きたい場所で「リピあり」か「リピなし」を押すと、こちらに移ります。'
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
              onChooseRevisit={chooseRevisit}
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
