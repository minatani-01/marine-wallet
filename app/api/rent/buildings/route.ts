import { NextResponse } from 'next/server'

import { spendApiCalls } from '@/lib/api-budget'
import { getProfile, getSessionUser } from '@/lib/queries'
import {
  boundsOf,
  boundsSpan,
  coverCircles,
  insideAll,
  meetsAll,
  measureOrder,
  mergeBuildings,
  nearestFacilities,
  nearestFood,
  rejectRentReason,
  searchArea,
  toFoodRating,
  type Facility,
  type FoodPlace,
  type RentBuilding,
  type RentStation,
} from '@/lib/rent'
import { searchFood, searchHousing, walkMatrix } from '@/lib/rent-google'
import { fetchOsmBuildings } from '@/lib/rent-osm'

/**
 * 指定した駅すべてから徒歩圏内にある建物を返す（0075）。
 *
 * 空室では探さない。範囲の中に「建っているもの」を並べる。部屋が空くのは
 * あとの話で、先に決めたいのは場所である。
 *
 * 集め方は2段。
 *   1. OSM で範囲の中の建物をまとめて取る（無料・取りこぼしが少ない）
 *   2. Google で名前を補う（OSM は名前が欠けていることが多い）
 * 最後に Google の徒歩ルートで、駅からの時間を実測する。直線距離の換算だと、
 * 川や線路で回り道になる場所が「徒歩8分」に見えてしまう。
 *
 * master だけの機能。費用のかかる呼び出しをまとめて使うので、ここでも見る。
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** 取りに行く範囲の上限（対角の長さ）。これ以上は OSM にも負担をかける */
const MAX_SPAN_M = 9000

/** 名前を聞く円の半径と、聞く回数の上限 */
const NEARBY_RADIUS = 400
const NEARBY_MAX_CALLS = 6

/**
 * 徒歩時間を実測する建物の数。
 *
 * 駅数 × この数が課金の単位（element）になる。多く測るほど待たされるし、
 * 無料の範囲も早く尽きる。あふれたぶんは返さない。測れた建物と測れていない
 * 建物を混ぜて出すと、どれが確かな徒歩◯分なのか見分けられない。
 */
const MEASURE_MAX = 40

export type BuildingsResponse = {
  area: { path: { lat: number; lng: number }[]; areaM2: number } | null
  buildings: RentBuilding[]
  stats: {
    /** 範囲の中にあった候補（実測する前） */
    candidates: number
    osm: number
    google: number
    /** 徒歩時間を実測できたか */
    measured: boolean
    /** 候補が多すぎて、一部しか測れなかったか */
    truncated: boolean
    /** まわりの施設を何件拾えたか（0077）。0なら施設の条件は使えない */
    facilities: number
    /** 星の条件で拾えた飲食店の数（0079）。聞いていなければ null */
    food: number | null
  }
  notes: string[]
  /** どこに聞いて、どうだったか。0件のときに画面へ出す（0076） */
  debug: string[]
}

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const profile = await getProfile(user.id)
  if (!profile?.is_master) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => ({}))) as {
    stations?: RentStation[]
    /** 飲食店も調べるか（0079）。星いくつ以上か */
    food?: { minRating?: number } | null
  }
  const stations = (body.stations ?? []).map((s) => ({
    id: String(s.id ?? ''),
    name: String(s.name ?? ''),
    lat: Number(s.lat),
    lng: Number(s.lng),
    minutes: Math.round(Number(s.minutes)),
  }))

  const reason = rejectRentReason(stations)
  if (reason) return NextResponse.json({ error: 'bad_request', reason }, { status: 400 })

  const area = searchArea(stations)
  if (!area) {
    return NextResponse.json({
      area: null,
      buildings: [],
      stats: {
        candidates: 0,
        osm: 0,
        google: 0,
        measured: false,
        truncated: false,
        facilities: 0,
        food: null,
      },
      notes: [],
      debug: [],
    } satisfies BuildingsResponse)
  }

  const bounds = boundsOf(area.path)
  if (!bounds) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  if (boundsSpan(bounds) > MAX_SPAN_M) {
    return NextResponse.json(
      { error: 'too_wide', reason: '範囲が広すぎます。徒歩時間を短くするか、駅を足してください。' },
      { status: 400 }
    )
  }

  const notes: string[] = []
  const debug: string[] = []
  const key = process.env.GOOGLE_MAPS_SERVER_KEY

  // ------------------------------------------------------------------
  // 1. OSM と Google を同時に聞く
  //
  // 順に聞くと、片方が重い日に60秒へ届いてしまう。どちらも相手の答えを
  // 必要としないので、並べて待つ
  // ------------------------------------------------------------------
  const circles = key ? coverCircles(area.path, stations, NEARBY_RADIUS, NEARBY_MAX_CALLS) : []

  const googleTask = async (): Promise<RentBuilding[]> => {
    if (!key) {
      notes.push('Google の鍵が設定されていないため、建物名と徒歩時間の実測は使えません。')
      return []
    }
    if (circles.length === 0) return []

    const spend = await spendApiCalls('places_nearby', circles.length)
    if (!spend.allowed) {
      notes.push('今日は Google に建物名を聞ける回数を使い切りました。名前は OSM のぶんだけです。')
      debug.push(`Google: 今日は上限（${spend.used_today}/${spend.daily}）`)
      return []
    }

    const found = await Promise.all(
      circles.map((c) => searchHousing(key, c, NEARBY_RADIUS, stations))
    )
    // 同じ聞き方の結果はまとめて1行にする。円の数だけ並べても読めない
    const lines = new Map<string, number>()
    for (const r of found) {
      for (const a of r.attempts) {
        const [head, tail] = [a.replace(/: \d+件$/, ''), /: (\d+)件$/.exec(a)?.[1]]
        const label = tail ? `${head}: 合計` : a
        lines.set(label, (lines.get(label) ?? 0) + Number(tail ?? 0))
      }
    }
    for (const [label, count] of lines) {
      debug.push(label.endsWith(': 合計') ? `${label.replace(': 合計', '')}: ${count}件` : label)
    }

    if (found.every((r) => r.items.length === 0)) {
      notes.push('Google から建物名を取れませんでした。')
    }

    const seen = new Set<string>()
    return found
      .flatMap((r) => r.items)
      .filter((b) => insideAll(b, stations))
      .filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)))
  }

  const osmTask = async (): Promise<{ buildings: RentBuilding[]; facilities: Facility[] }> => {
    const result = await fetchOsmBuildings(bounds, stations)
    debug.push(...result.attempts)
    if (result.buildings === null) {
      notes.push('OpenStreetMap から建物を取れませんでした。')
      return { buildings: [], facilities: [] }
    }
    return {
      buildings: result.buildings.filter((b) => insideAll(b, stations)),
      facilities: result.facilities,
    }
  }

  /**
   * 飲食店（0079）。
   *
   * 頼まれたときだけ聞く。口コミまで受け取ると課金の区分が上がるので、
   * 毎回聞いていると1日に数回しか探せなくなる。
   */
  const wantFood = Boolean(body.food)
  const minRating = toFoodRating(body.food?.minRating)

  const foodTask = async (): Promise<FoodPlace[] | null> => {
    if (!wantFood) return null
    if (!key || circles.length === 0) return []

    const spend = await spendApiCalls('places_rating', circles.length)
    if (!spend.allowed) {
      notes.push('今日は飲食店を調べられる回数を使い切りました。')
      debug.push(`飲食店: 今日は上限（${spend.used_today}/${spend.daily}）`)
      return []
    }

    const found = await Promise.all(
      circles.map((c) => searchFood(key, c, NEARBY_RADIUS, minRating))
    )
    let total = 0
    for (const r of found) {
      total += r.items.length
      for (const a of r.attempts) if (!a.endsWith('件')) debug.push(a)
    }
    debug.push(`飲食店（★${minRating.toFixed(1)}以上）: ${total}件`)

    const seen = new Set<string>()
    return found
      .flatMap((r) => r.items)
      .filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)))
  }

  const [osmResult, google, foods] = await Promise.all([osmTask(), googleTask(), foodTask()])
  const osm = osmResult.buildings
  const facilities = osmResult.facilities

  if (facilities.length === 0) {
    notes.push('まわりの施設を取れなかったので、施設の条件は使えません。')
  }

  const candidates = mergeBuildings(osm, google)

  // ------------------------------------------------------------------
  // 3. 徒歩時間の実測。測れるぶんだけに絞ってから測る
  // ------------------------------------------------------------------
  const ordered = measureOrder(candidates, stations).sort(
    (a, b) => Number(Boolean(b.name)) - Number(Boolean(a.name))
  )
  const truncated = ordered.length > MEASURE_MAX
  const targets = ordered.slice(0, MEASURE_MAX)

  // まわりの施設まで何分か（0077 / 0079）。出し分けは画面側でやるので、
  // ここでは全部の種類ぶん入れておく。チェックを変えるたびに聞き直さずに済む
  for (const b of targets) {
    b.near = nearestFacilities(b, facilities)
    if (foods) {
      const near = nearestFood(b, foods)
      if (near) b.food = near
    }
  }

  let measured = false
  if (key && targets.length > 0) {
    const elements = targets.length * stations.length
    const spend = await spendApiCalls('routes_walk', elements)
    if (!spend.allowed) {
      notes.push('今日は徒歩時間を実測できる回数を使い切りました。直線距離からの概算です。')
    } else {
      const { cells, attempt } = await walkMatrix(key, stations, targets)
      debug.push(attempt)
      if (cells === null) {
        notes.push('徒歩ルートを取れませんでした。直線距離からの概算です。')
      } else {
        for (const cell of cells) {
          const station = stations[cell.originIndex]
          const building = targets[cell.destinationIndex]
          if (!station || !building) continue
          building.walk[station.id] = { minutes: cell.minutes, measured: true }
        }
        measured = true
      }
    }
  }

  // 実測できたときは、実測した時間で条件を満たすものだけ残す。
  // 概算のままのときは、直線距離で届いているものをそのまま返す
  const buildings = measured ? targets.filter((b) => meetsAll(b, stations)) : targets

  if (truncated) {
    notes.push(
      `範囲の中の候補が${ordered.length}件あったため、近いものから${MEASURE_MAX}件だけ調べました。徒歩時間を短くすると全部入ります。`
    )
  }

  return NextResponse.json({
    area,
    buildings,
    stats: {
      candidates: ordered.length,
      osm: osm.length,
      google: google.length,
      measured,
      truncated,
      facilities: facilities.length,
      food: foods ? foods.length : null,
    },
    notes,
    debug,
  } satisfies BuildingsResponse)
}
