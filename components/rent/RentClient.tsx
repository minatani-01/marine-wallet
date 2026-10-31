'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import RentMap, { STATION_COLORS } from '@/components/rent/RentMap'
import {
  IconClose,
  IconExternal,
  IconHome,
  IconMap,
  IconPlus,
  IconSearch,
  IconWalk,
} from '@/components/icons'
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  PillTabs,
  SectionLabel,
  inputClass,
} from '@/components/ui'
import { withTapFeedback } from '@/lib/haptics'
import {
  DEFAULT_FACILITY_WALK,
  DEFAULT_FOOD_RATING,
  DEFAULT_RENT_SORT,
  DEFAULT_WALK,
  FACILITIES,
  FACILITY_WALKS,
  FLOOR_STEPS,
  FOOD_RATINGS,
  MAX_RENT_STATIONS,
  MAX_WALK,
  MIN_WALK,
  RENT_SORTS,
  areaText,
  buildingAge,
  distText,
  facilityLabel,
  hasFacility,
  hasSameStation,
  meetsFloors,
  pairGaps,
  ratingText,
  searchArea,
  sortBuildings,
  stationLabel,
  toFacilityKinds,
  toFloorStep,
  toFoodRating,
  type FacilityKind,
  type RentBuilding,
  type RentPoint,
  type RentSort,
  type RentStation,
} from '@/lib/rent'
import { createClient } from '@/lib/supabase/client'
import type { BuildingsResponse } from '@/app/api/rent/buildings/route'
import type { StationHit } from '@/app/api/rent/stations/route'
import type { RentSearch } from '@/types'

/** 条件を覚えておく場所。端末ごとで、相手には移らない */
const SAVE_KEY = 'marine-wallet:rent-stations'
const FACILITY_KEY = 'marine-wallet:rent-facilities'

/**
 * 賃貸さがし（0075）。master だけの画面。
 *
 * 空室では探さない。「この駅とこの駅、どちらからも歩けるところ」を先に決めて、
 * そこに建っている建物を並べる。部屋が空くのはあとの話で、場所は先に決まる。
 *
 * 駅は AND。SUUMO などで駅を2つ入れると「どちらかの駅から徒歩◯分」になり、
 * 片方からしか歩けない部屋が並ぶ。ここでは全部の駅の徒歩圏が重なったところ
 * だけを範囲にする。
 *
 * 建物を探すのは押したときだけにする。駅を足すたびに探しに行くと、外の
 * サービスを何度も呼ぶことになり、1日の上限がすぐ尽きる。
 */
export default function RentClient({
  userId,
  searches,
  thisYear,
}: {
  userId: string
  /** 名前を付けて残した駅の組み合わせ（0080） */
  searches: RentSearch[]
  /** 日本時間での今年。築年数を出すのに使う（0082） */
  thisYear: number
}) {
  const router = useRouter()
  const [stations, setStations] = useState<RentStation[]>([])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<StationHit[] | null>(null)
  const [searching, setSearching] = useState(false)

  const [result, setResult] = useState<BuildingsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<RentSort>(DEFAULT_RENT_SORT)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [pointSeq, setPointSeq] = useState(0)

  /**
   * 見たい施設と、そこまでの徒歩時間（0077 / 0078）。
   *
   * 絞り込みではない。あるか無いかを一覧に出すだけなので、はじめは全部
   * 見る側にしておく。チェックを外すと、その行が一覧から消える
   */
  const [wanted, setWanted] = useState<FacilityKind[]>(() => FACILITIES.map((f) => f.id))
  const [facilityWalk, setFacilityWalk] = useState<number>(DEFAULT_FACILITY_WALK)

  /**
   * 飲食店（0079）。
   *
   * ここだけ Google に聞きに行くので、チェックしただけでは出ない。
   * 探し直したときに調べる。毎回聞くと、1日に数回しか探せなくなる
   */
  const [wantFood, setWantFood] = useState(false)
  const [foodRating, setFoodRating] = useState<number>(DEFAULT_FOOD_RATING)

  /** 路線名を取れなかったときの知らせ（0086） */
  const [lineNote, setLineNote] = useState<string | null>(null)

  /** 建物の階数の下限（0084）。0 なら指定なし */
  const [minFloors, setMinFloors] = useState(0)

  /** 保存するときの名前。空のままなら駅名をつないだものにする（0080） */
  const [saveName, setSaveName] = useState('')
  const [savingSet, setSavingSet] = useState(false)

  /** 前に入れた駅を出しておく。毎回入れ直すのでは続けて使えない */
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SAVE_KEY)
      if (saved) setStations(JSON.parse(saved) as RentStation[])
    } catch {
      // 読めなければ何も入れない
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(stations))
    } catch {
      // 書けなくても探すことはできる
    }
  }, [stations])

  /** 施設の条件も覚えておく。毎回チェックし直すのでは続けて使えない */
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(FACILITY_KEY)
      if (!saved) return
      const parsed = JSON.parse(saved) as {
        wanted?: unknown
        minutes?: unknown
        food?: unknown
        rating?: unknown
        floors?: unknown
      }
      if (Array.isArray(parsed.wanted)) setWanted(toFacilityKinds(parsed.wanted))
      if (FACILITY_WALKS.some((m) => m === parsed.minutes)) {
        setFacilityWalk(parsed.minutes as number)
      }
      setWantFood(parsed.food === true)
      setFoodRating(toFoodRating(parsed.rating))
      setMinFloors(toFloorStep(parsed.floors))
    } catch {
      // 読めなければ既定のまま
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        FACILITY_KEY,
        JSON.stringify({
          wanted,
          minutes: facilityWalk,
          food: wantFood,
          rating: foodRating,
          floors: minFloors,
        })
      )
    } catch {
      // 書けなくても探すことはできる
    }
  }, [wanted, facilityWalk, wantFood, foodRating, minFloors])

  /**
   * 路線名の足りない駅を埋める（0086）。
   *
   * 路線名が付く前に入れた駅は、名前だけのまま端末に残っている。開いた
   * ときに一度だけ取り直す。OSM に聞くだけなので費用はかからない。
   */
  // 地図で選んだ地点は駅ではないので、路線名は付けない
  const missing = stations.filter((s) => !s.line && !s.name.startsWith('指定した地点'))
  const missingKey = missing.map((s) => s.id).join(',')

  useEffect(() => {
    if (missingKey === '') return
    let alive = true

    const fill = async () => {
      const targets = missing.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng }))
      const res = await fetch('/api/rent/lines', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          points: targets.map((t) => ({ name: t.name, lat: t.lat, lng: t.lng })),
        }),
      }).catch(() => null)
      if (!alive || !res || !res.ok) return

      const body = (await res.json()) as { lines?: (string | null)[]; lineNote?: string | null }
      if (!alive) return
      if (body.lineNote) setLineNote(body.lineNote)

      const found = body.lines ?? []
      if (found.every((line) => !line)) return

      setStations((all) =>
        all.map((station) => {
          const at = targets.findIndex((t) => t.id === station.id)
          const line = at >= 0 ? found[at] : null
          return line ? { ...station, line } : station
        })
      )
    }

    void fill()
    return () => {
      alive = false
    }
    // 足りない駅の組が変わったときだけ走らせる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey])

  /**
   * 重なりの範囲。
   *
   * 建物を探す前に出す。分数を変えるたびに塗りが縮むのが見えるので、
   * 探しに行く前に「この広さでよいか」を決められる。
   */
  const area = useMemo(() => searchArea(stations), [stations])
  const gaps = useMemo(() => (area ? [] : pairGaps(stations)), [area, stations])

  /**
   * 出す建物。
   *
   * 階数の条件は画面の中だけで効かせる（0084）。階数は検索のときに受け取って
   * あるので、変えるたびに外へ聞き直さずに済む。
   */
  const buildings = useMemo(() => {
    if (!result) return []
    const kept = result.buildings.filter((b) => meetsFloors(b.levels, minFloors))
    return sortBuildings(kept, stations, sort)
  }, [result, stations, sort, minFloors])

  /** 階数の条件で外した数。階数が入っていない建物もここで落ちる */
  const droppedByFloors = result ? result.buildings.length - buildings.length : 0

  const addStation = (p: { name: string; lat: number; lng: number; line?: string }) => {
    setError(null)
    if (stations.length >= MAX_RENT_STATIONS) {
      setError(`駅は最大${MAX_RENT_STATIONS}つまでです`)
      return
    }
    // 同じ駅を2つ入れても、重なりは1つぶんのまま変わらない（0081）
    if (hasSameStation(stations, p)) {
      setError(`${p.name}はもう入っています`)
      setHits(null)
      return
    }
    const id = `s-${Date.now()}-${Math.round(Math.random() * 1000)}`
    setStations((all) => [
      ...all,
      { id, name: p.name, line: p.line, lat: p.lat, lng: p.lng, minutes: DEFAULT_WALK },
    ])
    setHits(null)
    setQuery('')
    // 条件が変わったら前の結果は消す。古い一覧が新しい条件のものに見える
    setResult(null)
  }

  /** 既定の名前。駅名をつなぐ。長くなりすぎたら切る */
  const defaultName = stations.map((s) => stationLabel(s)).join('・').slice(0, 60)

  /**
   * いまの駅を残す。
   *
   * 同じ名前なら上書きする（0080 の一意制約）。押し間違えて同じ組が並ぶと、
   * どれが新しいのか分からなくなる。
   */
  const saveSet = async () => {
    if (stations.length === 0) return
    const name = (saveName.trim() || defaultName).slice(0, 60)
    if (!name) return

    setSavingSet(true)
    setError(null)
    const supabase = createClient()
    const { error: failed } = await supabase
      .from('rent_searches')
      .upsert(
        { user_id: userId, name, stations, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,name' }
      )

    setSavingSet(false)
    if (failed) {
      setError('保存できませんでした')
      return
    }
    setSaveName('')
    router.refresh()
  }

  /** 残しておいた組を開く。前の結果は条件が変わるので捨てる */
  const loadSet = (set: RentSearch) => {
    setStations(set.stations)
    setResult(null)
    setError(null)
    setHits(null)
  }

  const removeSet = async (set: RentSearch) => {
    if (!window.confirm(`「${set.name}」を消しますか？`)) return

    const supabase = createClient()
    const { error: failed } = await supabase.from('rent_searches').delete().eq('id', set.id)
    if (failed) {
      setError('消せませんでした')
      return
    }
    router.refresh()
  }

  const searchStations = async () => {
    const text = query.trim()
    if (!text) return

    setSearching(true)
    setError(null)
    const res = await fetch('/api/rent/stations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: text }),
    }).catch(() => null)
    setSearching(false)

    if (!res || !res.ok) {
      setHits(null)
      setError(
        res?.status === 429
          ? '今日は駅を探せる回数を使い切りました'
          : '駅を探せませんでした。入れ方を変えてもう一度お試しください'
      )
      return
    }

    const body = (await res.json()) as { hits?: StationHit[]; lineNote?: string | null }
    setHits(body.hits ?? [])
    setLineNote(body.lineNote ?? null)
  }

  const searchBuildings = async () => {
    if (stations.length === 0 || !area) return

    setLoading(true)
    setError(null)
    setActiveId(null)

    const res = await fetch('/api/rent/buildings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stations,
        food: wantFood ? { minRating: foodRating } : null,
      }),
    }).catch(() => null)
    setLoading(false)

    if (!res || !res.ok) {
      const body = res ? ((await res.json().catch(() => ({}))) as { reason?: string }) : {}
      setResult(null)
      setError(body.reason ?? '建物を探せませんでした。しばらく置いてからお試しください')
      return
    }

    setResult((await res.json()) as BuildingsResponse)
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SectionLabel>地図</SectionLabel>
        <RentMap
          stations={stations}
          area={area?.path ?? null}
          buildings={buildings}
          activeId={activeId}
          onSelect={setActiveId}
          onPick={(point: RentPoint) => {
            setPointSeq((n) => n + 1)
            addStation({ name: `指定した地点${pointSeq + 1}`, ...point })
          }}
        />
      </div>

      <div>
        <SectionLabel>駅を足す</SectionLabel>
        <Card>
          <div className="flex gap-2">
            <input
              type="search"
              value={query}
              aria-label="駅名"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void searchStations()
              }}
              placeholder="恵比寿、中目黒…"
              className={inputClass}
            />
            <Button
              className="shrink-0"
              onClick={withTapFeedback(() => void searchStations())}
              disabled={searching || !query.trim()}
            >
              <IconSearch size={15} />
              {searching ? '探し中' : '探す'}
            </Button>
          </div>

          {hits ? (
            hits.length === 0 ? (
              <p className="mt-3 text-[12px] text-fg-mute">
                駅が見つかりませんでした。地図の
                <IconMap size={12} className="mx-1 inline align-[-1px]" />
                から、場所を直に指定することもできます。
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-1.5">
                {hits.map((hit) => (
                  <li key={`${hit.line ?? ''}-${hit.name}-${hit.lat}-${hit.lng}`}>
                    <button
                      type="button"
                      onClick={withTapFeedback(() => addStation(hit))}
                      className="w-full rounded-xl border border-line px-3 py-2 text-left transition-colors hover:border-marine/60"
                    >
                      <span className="block truncate text-[13px] font-semibold">
                        {hit.line ? (
                          <span className="mr-1.5 font-normal text-fg-mute">{hit.line}</span>
                        ) : null}
                        {hit.name}
                      </span>
                      {hit.address ? (
                        <span className="mt-0.5 block truncate text-[11px] text-fg-mute">
                          {hit.address}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}

          {lineNote ? (
            <p className="mt-2 text-[11px] leading-relaxed text-fg-mute">
              {lineNote}（OpenStreetMap に届きませんでした）。駅名だけで探せます。
            </p>
          ) : null}

          {stations.length === 0 ? (
            <p className="mt-3 text-[11px] leading-relaxed text-fg-mute">
              駅を2つ以上入れると、どちらからも歩ける範囲だけが残ります。
              職場や実家など駅でない場所は、地図の
              <IconMap size={12} className="mx-1 inline align-[-1px]" />
              から足せます。
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {stations.map((s, index) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2"
                >
                  <span
                    aria-hidden="true"
                    className="tnum inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-ink"
                    style={{ backgroundColor: STATION_COLORS[index % STATION_COLORS.length] }}
                  >
                    {index + 1}
                  </span>
                  {/* 路線名は弱く、駅名を立てる（0087）。探しているのは駅で、
                      路線はどの駅かを見分けるための手がかりである */}
                  <span
                    title={stationLabel(s)}
                    className="min-w-0 flex-1 truncate text-[13px] font-semibold"
                  >
                    {/* 狭い画面では路線名を上の行に送る。横に並べたままだと
                        駅名のほうが切れる（0087） */}
                    {s.line ? (
                      <span className="mr-1 block text-[11px] font-normal text-fg-mute min-[360px]:inline">
                        {s.line}
                      </span>
                    ) : null}
                    {s.name}
                  </span>

                  {/* 「徒歩」の字は落とす（0085）。路線名が付いて駅名が長く
                      なったので、名前に幅を回す。分数と「分」で意味は通る */}
                  <label className="flex shrink-0 items-center gap-1 text-[11px] text-fg-mute">
                    <select
                      aria-label={`${s.name}からの徒歩時間`}
                      value={s.minutes}
                      onChange={(e) => {
                        const minutes = Number(e.target.value)
                        setStations((all) =>
                          all.map((x) => (x.id === s.id ? { ...x, minutes } : x))
                        )
                        setResult(null)
                      }}
                      className="tnum rounded-lg border border-line bg-white/[0.04] px-1 py-1 text-[12px] font-semibold text-fg"
                    >
                      {Array.from({ length: MAX_WALK - MIN_WALK + 1 }, (_, i) => MIN_WALK + i).map(
                        (m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        )
                      )}
                    </select>
                    分
                  </label>

                  <button
                    type="button"
                    aria-label={`${s.name}を外す`}
                    onClick={withTapFeedback(() => {
                      setStations((all) => all.filter((x) => x.id !== s.id))
                      setResult(null)
                    })}
                    className="inline-flex h-7 w-6 shrink-0 items-center justify-center rounded-lg text-fg-mute transition-colors hover:text-danger"
                  >
                    <IconClose size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* 駅の組み合わせを残す（0080）。候補を見比べているあいだ、
              1駅ずつ入れ直すのでは続かない */}
          {stations.length > 0 ? (
            <div className="mt-3 flex gap-2 border-t border-line pt-3">
              <input
                type="text"
                value={saveName}
                aria-label="この組み合わせの名前"
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="例：職場の近く"
                maxLength={60}
                className={inputClass}
              />
              <Button
                className="shrink-0"
                onClick={withTapFeedback(() => void saveSet())}
                disabled={savingSet}
              >
                <IconPlus size={15} />
                {savingSet ? '保存中' : '保存'}
              </Button>
            </div>
          ) : null}

          {/* 何を入れる欄なのかを書いておく。駅名を例に出すと、駅を入れる欄に
              見えてしまう（0081） */}
          {stations.length > 0 ? (
            <p className="mt-1.5 text-[11px] leading-relaxed text-fg-mute">
              あとで呼び出すときの名前です。空のままなら「{defaultName}」になります。
            </p>
          ) : null}

          {searches.length > 0 ? (
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {searches.map((set) => (
                <li key={set.id} className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={withTapFeedback(() => loadSet(set))}
                    className="min-w-0 flex-1 rounded-xl border border-line px-3 py-2 text-left transition-colors hover:border-marine/60"
                  >
                    <span className="block truncate text-[13px]">{set.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-fg-mute">
                      {set.stations
                        .map((s) => `${stationLabel(s)} 徒歩${s.minutes}分`)
                        .join('｜')}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`${set.name}を消す`}
                    onClick={withTapFeedback(() => void removeSet(set))}
                    className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-lg text-fg-mute transition-colors hover:text-danger"
                  >
                    <IconClose size={13} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {error ? <p className="mt-2.5 text-[12px] text-danger">{error}</p> : null}

          <Button
            variant="primary"
            full
            className="mt-3"
            onClick={withTapFeedback(() => void searchBuildings())}
            disabled={loading || stations.length === 0 || !area}
          >
            {loading ? '探しています…' : 'この範囲の建物を探す'}
          </Button>
        </Card>
      </div>

      {/* 範囲のようす。探す前から出す。狭すぎ・広すぎがその場で分かる */}
      <div>
        <SectionLabel>範囲</SectionLabel>
        <Card>
          {stations.length === 0 ? (
            <p className="text-[13px] text-fg-dim">駅を入れると、歩ける範囲を出します。</p>
          ) : area ? (
            <>
              <p className="text-[14px] font-semibold">
                {stations.length === 1
                  ? `${stations[0].name}から徒歩${stations[0].minutes}分の範囲`
                  : `${stations.length}つすべてから歩ける範囲があります`}
              </p>
              <p className="mt-1 text-[12px] text-fg-mute">
                広さは{areaText(area.areaM2)}
                {stations.length > 1 ? '（直線距離での概算）' : ''}
              </p>
            </>
          ) : (
            <>
              <p className="text-[14px] font-semibold text-warn">
                すべてから歩ける範囲がありません
              </p>
              {gaps.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {gaps.map((g) => (
                    <li key={`${g.a.id}-${g.b.id}`} className="text-[12px] text-fg-dim">
                      {g.a.name}と{g.b.name}は{distText(g.meters)}離れています。重なるには
                      どちらも徒歩{g.needEach}分以上が要ります。
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-[12px] text-fg-mute">
                  2つずつなら重なりますが、全部に共通する範囲がありません。どれかの徒歩時間を
                  延ばしてください。
                </p>
              )}
            </>
          )}
        </Card>
      </div>

      {/* 建物の条件（0084）。階数は OSM に入っている建物にしか無いので、
          指定すると「分からないもの」も落ちる。何件落としたかは出す */}
      <div>
        <SectionLabel>建物の条件</SectionLabel>
        <Card>
          <div className="flex items-center gap-2 text-[12px] text-fg-mute">
            <span>階数</span>
            <select
              aria-label="階数の下限"
              value={minFloors}
              onChange={(e) => setMinFloors(Number(e.target.value))}
              className="tnum rounded-lg border border-line bg-white/[0.04] px-2 py-1.5 text-[12px] font-semibold text-fg"
            >
              <option value={0}>指定なし</option>
              {FLOOR_STEPS.map((f) => (
                <option key={f} value={f}>
                  {f}階建て以上
                </option>
              ))}
            </select>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-fg-mute">
            階数は分かっている建物にしか入っていません。指定すると、階数が分からない建物も
            一覧から外れます。
            {minFloors > 0 && droppedByFloors > 0
              ? `いまは${droppedByFloors}件を外しています。`
              : ''}
          </p>
        </Card>
      </div>

      {/* まわりの施設（0077 / 0078）。建物は落とさない。あるか無いかを
          一覧に出すだけ。歯科が無いからといって住めないわけではない */}
      <div>
        <SectionLabel>まわりの施設を見る</SectionLabel>
        <Card>
          <div className="flex flex-wrap gap-2">
            {FACILITIES.map((f) => (
              <Checkbox
                key={f.id}
                checked={wanted.includes(f.id)}
                onChange={(on) =>
                  setWanted((all) => (on ? [...all, f.id] : all.filter((x) => x !== f.id)))
                }
                label={f.label}
              />
            ))}
          </div>

          {/* 飲食店だけは Google に聞きに行く（0079）。口コミは Google に
              しかなく、聞くたびに費用がかかる。探し直したときに調べる */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
            <Checkbox
              checked={wantFood}
              onChange={setWantFood}
              label={`飲食店（${ratingText(foodRating)}以上）`}
            />
            {wantFood ? (
              <select
                aria-label="飲食店の評価"
                value={foodRating}
                onChange={(e) => setFoodRating(Number(e.target.value))}
                className="tnum rounded-lg border border-line bg-white/[0.04] px-2 py-1.5 text-[12px] font-semibold text-fg"
              >
                {FOOD_RATINGS.map((r) => (
                  <option key={r} value={r}>
                    {ratingText(r)}以上
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          {wantFood && result && result.stats.food === null ? (
            <p className="mt-2 text-[11px] leading-relaxed text-warn">
              飲食店はまだ調べていません。「この範囲の建物を探す」をもう一度押してください。
            </p>
          ) : null}

          <div className="mt-3 flex items-center gap-2 text-[12px] text-fg-mute">
            <span>建物から徒歩</span>
            <select
              aria-label="施設までの徒歩時間"
              value={facilityWalk}
              onChange={(e) => setFacilityWalk(Number(e.target.value))}
              className="tnum rounded-lg border border-line bg-white/[0.04] px-2 py-1 text-[12px] font-semibold text-fg"
            >
              {FACILITY_WALKS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <span>分以内にあること</span>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-fg-mute">
            チェックしたものが、建物から徒歩{facilityWalk}分以内にあるかを一覧に出します。
            建物は減りません。時間は直線距離からの概算です。飲食店だけは Google の口コミを
            見るため、探し直したときに調べます。
            {result && result.stats.facilities === 0
              ? 'いまはまわりの施設を取れていないため、「なし」と出ます。'
              : ''}
          </p>
        </Card>
      </div>

      {result ? (
        <div>
          <SectionLabel>見つかった建物 {buildings.length}件</SectionLabel>

          {/* 並べ替えは横に流す。見出しの右に置くと、狭い画面で見出しが潰れる */}
          {buildings.length > 0 ? (
            <div className="mb-2.5">
              <PillTabs
                value={sort}
                options={RENT_SORTS.map((item) => ({ id: item.id, label: item.label }))}
                onChange={setSort}
              />
            </div>
          ) : null}

          {result.notes.length > 0 || result.debug.length > 0 ? (
            <Card className="mb-2.5 !p-3">
              <ul className="flex flex-col gap-1">
                {result.notes.map((note) => (
                  <li key={note} className="text-[11px] leading-relaxed text-fg-mute">
                    {note}
                  </li>
                ))}
              </ul>

              {/* どこに聞いて何が返ったかを出す。「取れませんでした」だけでは、
                  こちらの作りが悪いのか、相手が混んでいるのかが分からない。
                  件数が少ないときも同じなので、0件に限らず出す（0083） */}
              {result.debug.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-0.5 border-t border-line pt-2">
                  {result.debug.map((line) => (
                    <li key={line} className="tnum text-[10px] leading-relaxed text-fg-mute">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : null}

          {buildings.length === 0 ? (
            <EmptyState
              title="この範囲に建物が見つかりませんでした"
              description="徒歩時間を延ばすか、駅を減らしてもう一度お試しください。"
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {buildings.map((b) => (
                <BuildingRow
                  key={b.id}
                  building={b}
                  stations={stations}
                  wanted={wanted}
                  wantFood={wantFood}
                  thisYear={thisYear}
                  foodKnown={result.stats.food !== null}
                  facilityWalk={facilityWalk}
                  active={activeId === b.id}
                  onSelect={() => setActiveId(activeId === b.id ? null : b.id)}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* 建物の輪郭は OpenStreetMap のデータ（ODbL）。無料で使える代わりに、
          出典を出すことが条件になっている。リンクも付けておく */}
      <p className="px-1 text-[11px] leading-relaxed text-fg-mute">
        建物は{' '}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-2 hover:text-marine"
        >
          © OpenStreetMap contributors
        </a>{' '}
        と Google マップから集めています。空室かどうかは見ていないので、 住めるかどうかは
        管理会社や募集情報で確かめてください。
        {result?.stats.measured
          ? '徒歩時間は Google の徒歩ルートでの実測です。'
          : '徒歩時間は直線距離を80m＝1分で割った概算です。'}
      </p>
    </div>
  )
}

/**
 * 1件ぶん。
 *
 * 駅ごとの徒歩分を全部出す。AND で探しているので、「いちばん遠い駅まで何分か」
 * が決め手になる。1つの数にまとめると、どの駅が遠いのか分からない。
 */
function BuildingRow({
  building,
  stations,
  wanted,
  wantFood,
  foodKnown,
  facilityWalk,
  thisYear,
  active,
  onSelect,
}: {
  building: RentBuilding
  stations: RentStation[]
  /** 見たい施設。チェックしたものだけ出す */
  wanted: FacilityKind[]
  /** 飲食店も出すか（0079） */
  wantFood: boolean
  /** その検索で飲食店を調べたか。調べていなければ「なし」とは言えない */
  foodKnown: boolean
  /** 徒歩何分以内なら「ある」とするか */
  facilityWalk: number
  /** 日本時間での今年。築年数を出すのに使う */
  thisYear: number
  active: boolean
  onSelect: () => void
}) {
  const name = building.name || '名前の分からない建物'
  const age = buildingAge(building.builtYear, thisYear)
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${building.lat},${building.lng}`

  /**
   * 物件名で探しに行く先（0082）。
   *
   * 築年数・構造・戸数は、無料で引ける公的なデータに入っていない。掲載が
   * あれば各サイトに載っているので、名前で開けるようにしておく。1回押せば
   * 済むぶん、自分で名前を打ち直すより早い。
   *
   * サイトの中の検索URLは作りが変わると壊れるので、サイトを指定した
   * 検索で開く。向こうの作りが変わっても動く。
   */
  const siteSearch = (site: string) =>
    `https://www.google.com/search?q=${encodeURIComponent(`site:${site} "${building.name}"`)}`
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`"${building.name}" 賃貸`)}`

  return (
    <li
      className={`glass overflow-hidden rounded-2xl border transition-colors ${
        active ? 'border-marine/60' : 'border-line'
      }`}
    >
      <button
        type="button"
        onClick={withTapFeedback(onSelect)}
        aria-label={`${name}を地図で見る`}
        className="w-full p-3.5 text-left"
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-line text-fg-mute">
            <IconHome size={16} />
          </span>

          <div className="min-w-0 flex-1">
            <span
              className={`block truncate text-[14px] font-semibold ${
                building.name ? '' : 'text-fg-mute'
              }`}
            >
              {name}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-fg-mute">
              {[
                building.kind,
                building.levels ? `${building.levels}階建て` : '',
                // 竣工年が入っていれば築年数も出す（0082）。入っていない
                // ことのほうが多いので、無ければ何も出さない
                age != null ? `築${age}年` : '',
                building.address,
              ]
                .filter(Boolean)
                .join('｜')}
            </span>
          </div>
        </div>

        {/* まわりの施設（0078）。駅の行とは分けて出す。混ぜると、どれが駅で
            どれが店なのか読み取れない。
            無いものも「なし」と出す。行ごと消すと、調べたうえで無いのか、
            そもそも調べていないのかが分からない */}
        {wanted.length > 0 || wantFood ? (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            {/* 飲食店は星まで出す（0079）。近いだけの店より、入りたい店が
                あるかどうかで決まる */}
            {wantFood ? (
              <span
                className={`whitespace-nowrap ${
                  foodKnown && building.food && building.food.minutes <= facilityWalk
                    ? 'text-fg-dim'
                    : 'text-fg-mute'
                }`}
              >
                飲食店
                {/* 調べていないうちに「なし」と書くと、無いと思ってしまう */}
                {!foodKnown ? (
                  <span className="ml-1">未調査</span>
                ) : building.food && building.food.minutes <= facilityWalk ? (
                  <span className="tnum ml-1 font-semibold text-teal">
                    {building.food.minutes}分 {ratingText(building.food.rating)}
                  </span>
                ) : (
                  <span className="ml-1">なし</span>
                )}
              </span>
            ) : null}

            {FACILITIES.filter((f) => wanted.includes(f.id)).map((f) => {
              const minutes = building.near?.[f.id]
              const found = hasFacility(building.near, f.id, facilityWalk)
              return (
                <span
                  key={f.id}
                  className={`whitespace-nowrap ${found ? 'text-fg-dim' : 'text-fg-mute'}`}
                >
                  {facilityLabel(f.id)}
                  {found ? (
                    <span className="tnum ml-1 font-semibold text-teal">{minutes}分</span>
                  ) : (
                    <span className="ml-1">なし</span>
                  )}
                </span>
              )
            })}
          </div>
        ) : null}

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {stations.map((s, index) => {
            const w = building.walk[s.id]
            if (!w) return null
            return (
              <span key={s.id} className="flex items-center gap-1 text-[11px] text-fg-dim">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: STATION_COLORS[index % STATION_COLORS.length] }}
                />
                <span className="truncate">{s.name}</span>
                <span className="tnum font-semibold text-fg">徒歩{w.minutes}分</span>
                {w.measured ? null : <span className="text-fg-mute">概算</span>}
              </span>
            )
          })}
        </div>
      </button>

      {active ? (
        <div className="flex flex-wrap gap-2 border-t border-line px-3.5 py-2.5">
          <a
            href={mapUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[12px] text-fg-dim transition-colors hover:border-marine/60 hover:text-marine"
          >
            <IconMap size={14} />
            地図で開く
          </a>
          {building.name ? (
            <>
              <a
                href={siteSearch('suumo.jp')}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[12px] text-fg-dim transition-colors hover:border-marine/60 hover:text-marine"
              >
                <IconExternal size={14} />
                SUUMO
              </a>
              <a
                href={siteSearch('homes.co.jp')}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[12px] text-fg-dim transition-colors hover:border-marine/60 hover:text-marine"
              >
                <IconExternal size={14} />
                HOME&apos;S
              </a>
              <a
                href={searchUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[12px] text-fg-dim transition-colors hover:border-marine/60 hover:text-marine"
              >
                <IconSearch size={14} />
                検索
              </a>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-mute">
              <IconWalk size={14} />
              名前が分からないので、地図で場所を見てください
            </span>
          )}
        </div>
      ) : null}
    </li>
  )
}
