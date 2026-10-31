/**
 * 賃貸さがし（0075）。master だけの機能。
 *
 * 空室かどうかでは探さない。SUUMO などは「いま空いている部屋」の一覧なので、
 * 住みたい場所が決まっていても、その場所に建っている建物は分からない。
 * ここでは逆にする。場所を決めて、そこに建っている集合住宅を並べる。
 *
 * 駅は AND でつなぐ。既存のサービスで駅を複数入れると「どれかの駅から
 * 徒歩◯分」になるが、探しているのは「どちらの駅からも歩ける場所」である。
 * 全部の駅の徒歩圏が重なったところだけを範囲にする。
 *
 * ここは純関数だけ。外に出て行く処理（Overpass / Google）は lib/rent-osm.ts と
 * lib/rent-google.ts に分けてある。
 */

/** 不動産広告の表示基準。道路距離80mを1分として切り上げる */
export const METERS_PER_MINUTE = 80

/** 一度に指定できる駅の数。これ以上重ねると、まず範囲が残らない */
export const MAX_RENT_STATIONS = 5

export const MIN_WALK = 1
export const MAX_WALK = 30
export const DEFAULT_WALK = 10

export type RentPoint = { lat: number; lng: number }

/** 指定した駅（地図で選んだ地点も同じ形で持つ） */
export type RentStation = RentPoint & {
  id: string
  name: string
  /** この駅から何分以内か */
  minutes: number
  /** 路線名（0085）。取れたときだけ。複数あっても1つしか持たない */
  line?: string
}

/**
 * 駅の見出し（0085 / 0087）。
 *
 * 「JR山手線 御徒町駅」のように、路線名と駅名を空白で並べる。上野広小路・
 * 上野御徒町・御徒町のように、名前が似た別の駅が隣り合っていることがある。
 * 駅名だけでは、どれを入れたのか見分けが付かない。
 *
 * 路線が取れなければ駅名だけにする。複数の路線が通っていても1つしか
 * 出さない。どれか1つ分かれば見分けは付く。
 */
export function stationLabel(station: { name: string; line?: string }): string {
  return station.line ? `${station.line} ${station.name}` : station.name
}

/** 駅ごとの徒歩分。measured は Google の徒歩ルートで実測したもの */
export type RentWalk = { minutes: number; measured: boolean }

export type BuildingSource = 'osm' | 'google'

export type RentBuilding = RentPoint & {
  id: string
  source: BuildingSource
  /** 名前が分からない建物は空文字。地図には出すが、一覧では後ろに回す */
  name: string
  address: string
  /** 階数。OSM の building:levels が入っていれば */
  levels: number | null
  /** 竣工年。OSM の start_date が入っていれば（0082）。日本では稀 */
  builtYear: number | null
  /** 'マンション' など。元のタグから決める */
  kind: string
  /** 駅ID → 徒歩分 */
  walk: Record<string, RentWalk>
  /** まわりの施設まで何分か（0077）。取れていなければ無い */
  near?: NearFacilities
  /** いちばん近い飲食店（0079）。聞いていなければ無い */
  food?: NearFood
}

/**
 * まわりにあってほしいもの（0077）。
 *
 * 住むと決める前に見るのは、駅からの距離だけではない。夜に何か要ったとき、
 * 風邪をひいたとき、歯が痛くなったときに、歩いて行けるかどうかで暮らしが
 * 変わる。駅が同じでも、ここが違えば別の場所である。
 */
export const FACILITIES = [
  { id: 'convenience', label: 'コンビニ' },
  { id: 'pharmacy', label: '薬局' },
  { id: 'dentist', label: '歯科' },
  { id: 'clinic', label: '内科' },
  { id: 'hairdresser', label: '美容院' },
] as const

export type FacilityKind = (typeof FACILITIES)[number]['id']

export type Facility = RentPoint & { id: string; kind: FacilityKind; name: string }

/** 施設の種類 → いちばん近いものまでの徒歩分（直線距離から） */
export type NearFacilities = Partial<Record<FacilityKind, number>>

/** 施設までの徒歩時間として選べるもの */
export const FACILITY_WALKS = [3, 5, 7, 10] as const

export const DEFAULT_FACILITY_WALK = 5

export function facilityLabel(kind: FacilityKind): string {
  return FACILITIES.find((f) => f.id === kind)?.label ?? kind
}

/** 知らない値を捨てる。覚えておいた条件を読み直すときに使う */
export function toFacilityKinds(values: unknown): FacilityKind[] {
  if (!Array.isArray(values)) return []
  return FACILITIES.map((f) => f.id).filter((id) => values.includes(id))
}

export type Bounds = { south: number; west: number; north: number; east: number }

const RAD = Math.PI / 180

/** 2点の直線距離（m）。地球を球として扱う */
export function haversine(a: RentPoint, b: RentPoint): number {
  const R = 6371008.8
  const dLat = (b.lat - a.lat) * RAD
  const dLng = (b.lng - a.lng) * RAD
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** 直線距離を分に直す。道のりは必ずこれ以上かかるので、これは下限になる */
export function straightMinutes(meters: number): number {
  return Math.max(1, Math.ceil(meters / METERS_PER_MINUTE))
}

/** 徒歩◯分を半径（m）に直す */
export function walkRadius(minutes: number): number {
  return Math.max(MIN_WALK, minutes) * METERS_PER_MINUTE
}

/**
 * 緯度経度と、その場の平面座標を行き来する。
 *
 * 円の重なりを出すのに三角関数を何百回も回すので、いちど平面に落とす。
 * 数kmの範囲なら、この近似で誤差は1m に満たない。
 */
function makeProjection(ref: RentPoint) {
  const kx = 111320 * Math.cos(ref.lat * RAD)
  const ky = 110574
  return {
    toXY: (p: RentPoint) => ({ x: (p.lng - ref.lng) * kx, y: (p.lat - ref.lat) * ky }),
    toLL: (q: { x: number; y: number }) => ({ lat: ref.lat + q.y / ky, lng: ref.lng + q.x / kx }),
  }
}

/**
 * すべての駅の徒歩圏が重なる範囲。
 *
 * 円の共通部分は凸なので、各円周を細かく刻み、他の全部の円の中に入る点だけを
 * 集めて角度順に並べれば外周になる。重ならなければ null。
 */
export function intersectCircles(
  stations: RentStation[]
): { path: RentPoint[]; areaM2: number } | null {
  if (stations.length < 2) return null

  const ref = {
    lat: stations.reduce((a, s) => a + s.lat, 0) / stations.length,
    lng: stations.reduce((a, s) => a + s.lng, 0) / stations.length,
  }
  const proj = makeProjection(ref)
  const circles = stations.map((s) => ({ c: proj.toXY(s), r: walkRadius(s.minutes) }))

  const STEPS = 360
  // 円周どうしがかすめる所を落とさないよう、わずかに甘く見る
  const EPS = 0.5
  const pts: { x: number; y: number }[] = []

  circles.forEach((ci, i) => {
    for (let k = 0; k < STEPS; k++) {
      const t = (2 * Math.PI * k) / STEPS
      const p = { x: ci.c.x + ci.r * Math.cos(t), y: ci.c.y + ci.r * Math.sin(t) }
      const inside = circles.every(
        (cj, j) => j === i || Math.hypot(p.x - cj.c.x, p.y - cj.c.y) <= cj.r + EPS
      )
      if (inside) pts.push(p)
    }
  })

  if (pts.length < 3) return null

  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length
  pts.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))

  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    area += a.x * b.y - b.x * a.y
  }
  area = Math.abs(area) / 2
  if (area < 1) return null

  return { path: pts.map(proj.toLL), areaM2: area }
}

/** 点を囲む四角。建物を取りに行く範囲に使う */
export function boundsOf(points: RentPoint[]): Bounds | null {
  if (points.length === 0) return null
  return {
    south: Math.min(...points.map((p) => p.lat)),
    west: Math.min(...points.map((p) => p.lng)),
    north: Math.max(...points.map((p) => p.lat)),
    east: Math.max(...points.map((p) => p.lng)),
  }
}

/**
 * 円をなぞる輪郭。駅が1つだけのときの範囲に使う。
 *
 * 1駅でも「その駅から徒歩◯分」の範囲は決まる。重なりが無いからといって
 * 何も返さないと、1駅だけ入れたときに画面が空になる。
 */
export function circlePath(station: RentStation, steps = 72): RentPoint[] {
  const r = walkRadius(station.minutes)
  const dLat = r / 110574
  const dLng = r / (111320 * Math.cos(station.lat * RAD))
  const path: RentPoint[] = []
  for (let k = 0; k < steps; k++) {
    const t = (2 * Math.PI * k) / steps
    path.push({ lat: station.lat + dLat * Math.sin(t), lng: station.lng + dLng * Math.cos(t) })
  }
  return path
}

/**
 * 探す範囲。
 *
 * 2駅以上なら重なったところ、1駅ならその円。重ならなければ null で、
 * 呼ぶ側は「範囲がありません」として扱う。
 */
export function searchArea(
  stations: RentStation[]
): { path: RentPoint[]; areaM2: number } | null {
  if (stations.length === 0) return null
  if (stations.length === 1) {
    const r = walkRadius(stations[0].minutes)
    return { path: circlePath(stations[0]), areaM2: Math.PI * r * r }
  }
  return intersectCircles(stations)
}

/** 四角の対角の長さ（m）。取りに行く範囲が広すぎないかを見るのに使う */
export function boundsSpan(b: Bounds): number {
  return haversine({ lat: b.south, lng: b.west }, { lat: b.north, lng: b.east })
}

/**
 * 全部の駅から徒歩圏内か（直線距離で見る）。
 *
 * 道のりは直線より必ず長いので、直線で届かない建物は実測しても届かない。
 * 実測する前のふるいに使うと、測る件数を減らせて外れも出ない。
 */
export function insideAll(point: RentPoint, stations: RentStation[]): boolean {
  return stations.every((s) => haversine(s, point) <= walkRadius(s.minutes))
}

/** 駅ごとの直線距離から、実測前の徒歩分を埋める */
export function straightWalk(point: RentPoint, stations: RentStation[]): Record<string, RentWalk> {
  const walk: Record<string, RentWalk> = {}
  for (const s of stations) {
    walk[s.id] = { minutes: straightMinutes(haversine(s, point)), measured: false }
  }
  return walk
}

/** いちばん遠い駅までの徒歩分。AND なので、効くのはここ */
export function worstWalk(building: RentBuilding, stations: RentStation[]): number {
  let worst = 0
  for (const s of stations) {
    const w = building.walk[s.id]
    if (!w) return Number.POSITIVE_INFINITY
    worst = Math.max(worst, w.minutes)
  }
  return worst
}

/** 実測した徒歩分で、全部の駅の条件を満たしているか */
export function meetsAll(building: RentBuilding, stations: RentStation[]): boolean {
  return stations.every((s) => {
    const w = building.walk[s.id]
    return w != null && w.minutes <= s.minutes
  })
}

export const RENT_SORTS = [
  { id: 'walk', label: '駅から近い順' },
  { id: 'levels', label: '階数が多い順' },
  { id: 'name', label: '名前順' },
] as const

export type RentSort = (typeof RENT_SORTS)[number]['id']

export const DEFAULT_RENT_SORT: RentSort = 'walk'

export function toRentSort(value: string | null): RentSort {
  return RENT_SORTS.some((s) => s.id === value) ? (value as RentSort) : DEFAULT_RENT_SORT
}

/**
 * 並べ替える。
 *
 * どの並びでも、名前の分かっている建物を先に出す。名前が無い建物は調べようが
 * ないので、上に来ると一覧を読む手が止まる。
 */
export function sortBuildings(
  items: RentBuilding[],
  stations: RentStation[],
  by: RentSort
): RentBuilding[] {
  return [...items].sort((a, b) => {
    const named = Number(Boolean(b.name)) - Number(Boolean(a.name))
    if (named !== 0) return named

    if (by === 'levels') {
      const diff = (b.levels ?? 0) - (a.levels ?? 0)
      if (diff !== 0) return diff
    } else if (by === 'name') {
      const diff = a.name.localeCompare(b.name, 'ja')
      if (diff !== 0) return diff
    }

    const walk = worstWalk(a, stations) - worstWalk(b, stations)
    if (walk !== 0) return walk
    return a.name.localeCompare(b.name, 'ja')
  })
}

/**
 * 重ならない駅の組み合わせ。
 *
 * 範囲が出ないとき、ただ「ありません」と言われても次にどうすればいいか
 * 分からない。どの2駅が離れすぎていて、何分にすれば届くのかまで出す。
 */
export function pairGaps(stations: RentStation[]): {
  a: RentStation
  b: RentStation
  meters: number
  needEach: number
}[] {
  const out = []
  for (let i = 0; i < stations.length; i++) {
    for (let j = i + 1; j < stations.length; j++) {
      const a = stations[i]
      const b = stations[j]
      const meters = haversine(a, b)
      if (meters <= walkRadius(a.minutes) + walkRadius(b.minutes)) continue
      out.push({ a, b, meters, needEach: Math.ceil(meters / (2 * METERS_PER_MINUTE)) })
    }
  }
  return out
}

/**
 * もう入っている駅か（0081 / 0084 / 0087）。
 *
 * 見るのは「名前と路線の組」。同じものを2つ入れても、重なりは1つぶんのまま
 * 変わらず、一覧に同じ行が並ぶだけになる。
 *
 * 名前が同じでも路線が違えば別として入れる。中野坂上駅には丸ノ内線と
 * 都営大江戸線が通っていて、どちらで通うかは住む人の都合で変わる。
 * 上野広小路・上野御徒町・御徒町のように、別路線の別の駅が隣り合って
 * いる場所もあるので、近いという理由だけでも断らない。
 *
 * どちらかの路線が分からないときは、同じ名前なら同じ駅として断る。
 * 見分けの付かない行が2つ並んでも、見るほうが選べない。
 */
export function hasSameStation(
  stations: RentStation[],
  point: RentPoint & { name: string; line?: string }
): boolean {
  const line = point.line ?? ''

  return stations.some((s) => {
    const sameLine = (s.line ?? '') === line
    const unknown = !s.line || !line
    if (s.name === point.name) return sameLine || unknown
    // 同じ駅の別の出口。名前が少し違っても、ほぼ同じ点なら同じ駅とみなす
    return sameLine && haversine(s, point) < 30
  })
}

/* ------------------------------------------------------------- 階数 ---- */

/**
 * 建物の階数で絞る（0084）。
 *
 * 高さは住み心地に直に効く。ただし OSM に階数が入っている建物は一部なので、
 * 指定すると「分からないもの」も落ちる。何件落としたかは画面に出す。
 */
export const FLOOR_STEPS = [3, 5, 10, 20] as const

export function meetsFloors(levels: number | null | undefined, min: number): boolean {
  if (min <= 0) return true
  return levels != null && levels >= min
}

/** 覚えておいた階数の条件を読み直す。知らない値なら指定なしに戻す */
export function toFloorStep(value: unknown): number {
  return FLOOR_STEPS.some((f) => f === value) ? (value as number) : 0
}

/** 入力を確かめる。駄目なら理由を返す */
export function rejectRentReason(stations: RentStation[]): string | null {
  if (stations.length === 0) return '駅を追加してください'
  if (stations.length > MAX_RENT_STATIONS) {
    return `駅は最大${MAX_RENT_STATIONS}駅までです`
  }
  for (const s of stations) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) return '駅の場所が取れていません'
    if (!Number.isInteger(s.minutes) || s.minutes < MIN_WALK || s.minutes > MAX_WALK) {
      return `徒歩時間は${MIN_WALK}〜${MAX_WALK}分で指定してください`
    }
  }
  return null
}

/** 面積の見出し。m² のままだと桁が読めない */
export function areaText(m2: number): string {
  if (m2 >= 1_000_000) return `約${(m2 / 1_000_000).toFixed(2)}km²`
  if (m2 >= 10_000) return `約${(m2 / 10_000).toFixed(1)}ha`
  return `約${Math.round(m2).toLocaleString('ja-JP')}m²`
}

/** 距離の見出し */
export function distText(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)}km` : `${Math.round(m)}m`
}

/**
 * 建物を測りに行く順番。
 *
 * 実測には1件ずつ費用がかかるので、全部は測れない。重なりの中心に近い
 * ものから測る。中心に近いほど、どの駅からも歩ける見込みが高い。
 */
export function measureOrder(items: RentBuilding[], stations: RentStation[]): RentBuilding[] {
  return [...items].sort((a, b) => worstWalk(a, stations) - worstWalk(b, stations))
}

/**
 * Google に建物を聞きに行く円の置き方。
 *
 * 1回の検索で返るのは最大20件なので、広い範囲は1回では取り切れない。
 * 重なりの範囲に円を敷き詰めて、何回かに分けて聞く。円の数は上限で切る
 * （費用がかかるのと、待ち時間が延びるため）。
 */
export function coverCircles(
  path: RentPoint[],
  stations: RentStation[],
  radius: number,
  max: number
): RentPoint[] {
  const bounds = boundsOf(path)
  if (!bounds) return []

  const center = {
    lat: (bounds.south + bounds.north) / 2,
    lng: (bounds.west + bounds.east) / 2,
  }
  // 円どうしを少しだけ重ねて、継ぎ目に穴が開かないようにする
  const step = radius * 1.4
  const dLat = step / 110574
  const dLng = step / (111320 * Math.cos(center.lat * RAD))

  const rows = Math.max(1, Math.ceil((bounds.north - bounds.south) / dLat))
  const cols = Math.max(1, Math.ceil((bounds.east - bounds.west) / dLng))

  const points: RentPoint[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = {
        lat: bounds.south + dLat * (r + 0.5),
        lng: bounds.west + dLng * (c + 0.5),
      }
      if (insideAll(p, stations)) points.push(p)
    }
  }

  // 範囲が円より小さいと1つも残らない。そのときは真ん中を1回だけ聞く
  if (points.length === 0) return [center]
  if (points.length <= max) return points

  // 1回しか聞けないなら、範囲の真ん中あたりを1つ選ぶ
  if (max <= 1) return [points[Math.floor((points.length - 1) / 2)]]

  // 多すぎるときは間引く。端に寄せず、全体から等間隔で取る
  const picked: RentPoint[] = []
  for (let i = 0; i < max; i++) {
    picked.push(points[Math.round((i * (points.length - 1)) / (max - 1))])
  }
  return picked
}

/**
 * 同じ建物を1つにまとめる。
 *
 * OSM の輪郭と Google の地点は別々に取れてくるので、近くて名前の付いた
 * 地点を輪郭に寄せる。寄せる距離はごく短くする。隣のマンションの名前が
 * 付いてしまうと、現地で探しようがなくなる。
 */
export function mergeBuildings(
  osm: RentBuilding[],
  google: RentBuilding[],
  within = 40
): RentBuilding[] {
  const merged = osm.map((b) => ({ ...b }))
  const used = new Set<string>()

  for (const g of google) {
    let best: RentBuilding | null = null
    let bestDist = within

    for (const b of merged) {
      const d = haversine(b, g)
      if (d <= bestDist) {
        best = b
        bestDist = d
      }
    }

    if (best && !best.name) {
      best.name = g.name
      best.address = best.address || g.address
      used.add(g.id)
    } else if (best) {
      // 名前がすでにある輪郭は触らない。Google 側も捨てる（二重に並べない）
      used.add(g.id)
    }
  }

  return [...merged, ...google.filter((g) => !used.has(g.id))]
}

/**
 * 四角を広げる。
 *
 * 施設は範囲の外にあっても構わない。範囲のふちに建つ建物にとっては、
 * 道を挟んだ向かいのコンビニが「いちばん近い店」になる。建物を探す四角の
 * ままで聞くと、そういう店が1軒も入らない。
 */
export function expandBounds(bounds: Bounds, meters: number): Bounds {
  const dLat = meters / 110574
  const mid = (bounds.south + bounds.north) / 2
  const dLng = meters / (111320 * Math.cos(mid * RAD))
  return {
    south: bounds.south - dLat,
    west: bounds.west - dLng,
    north: bounds.north + dLat,
    east: bounds.east + dLng,
  }
}

/** 建物から、種類ごとに「いちばん近い1軒」までの徒歩分を出す */
export function nearestFacilities(point: RentPoint, facilities: Facility[]): NearFacilities {
  const best = new Map<FacilityKind, number>()
  for (const f of facilities) {
    const meters = haversine(point, f)
    const now = best.get(f.kind)
    if (now === undefined || meters < now) best.set(f.kind, meters)
  }

  const near: NearFacilities = {}
  for (const [kind, meters] of best) near[kind] = straightMinutes(meters)
  return near
}

/**
 * その施設が徒歩◯分以内にあるか（0078）。
 *
 * 建物を落とすためではなく、一覧に「ある・ない」を出すために使う。
 * 歯科が無いからといって、その建物が住めないわけではない。何があって
 * 何が無いかが並んでいれば、見るほうが決められる。
 */
export function hasFacility(
  near: NearFacilities | undefined,
  kind: FacilityKind,
  minutes: number
): boolean {
  const found = near?.[kind]
  return found !== undefined && found <= minutes
}

/* ----------------------------------------------------------- 飲食店 ---- */

/**
 * 飲食店（0079）。
 *
 * ここだけ出どころが Google になる。口コミの評価は Google にしかなく、
 * OSM は店の有無しか持っていない。「近くに店がある」ではなく「入りたい店が
 * ある」かどうかを見たいので、評価で切れるようにする。
 */
export const FOOD_RATINGS = [3, 3.5, 4] as const

export const DEFAULT_FOOD_RATING = 3

/** Google から返ってきた店 */
export type FoodPlace = RentPoint & { id: string; name: string; rating: number }

/** 建物からいちばん近い店 */
export type NearFood = { minutes: number; rating: number; name: string }

/** 星の出し方。3 は「★3.0」と書く。3 と 3.5 が並ぶと桁が揃わない */
export function ratingText(rating: number): string {
  return `★${rating.toFixed(1)}`
}

/**
 * いちばん近い店。
 *
 * 評価の高い店ではなく、近い店を採る。評価で切るのは Google に聞く時点で
 * 済んでいるので、ここに来るのは条件を満たした店だけである。
 */
export function nearestFood(point: RentPoint, foods: FoodPlace[]): NearFood | null {
  let best: FoodPlace | null = null
  let bestMeters = Number.POSITIVE_INFINITY

  for (const f of foods) {
    const meters = haversine(point, f)
    if (meters < bestMeters) {
      best = f
      bestMeters = meters
    }
  }

  if (!best) return null
  return { minutes: straightMinutes(bestMeters), rating: best.rating, name: best.name }
}

/** 覚えておいた星の条件を読み直す。知らない値なら既定に戻す */
export function toFoodRating(value: unknown): number {
  return FOOD_RATINGS.some((r) => r === value) ? (value as number) : DEFAULT_FOOD_RATING
}

/**
 * 築何年か（0082）。
 *
 * OSM の start_date が入っていれば出せる。日本では稀にしか入っていないので、
 * 出ない建物のほうが多い。分からないものを「築0年」と書くと、新築だと
 * 思われてしまうので、分からないときは null を返して何も出さない。
 */
export function buildingAge(builtYear: number | null | undefined, thisYear: number): number | null {
  if (builtYear == null) return null
  const age = thisYear - builtYear
  return age >= 0 && age < 200 ? age : null
}

/**
 * 竣工年を読む。
 *
 * OSM の start_date は「1998」「1998-04」「1998-04-01」「~1998」のように
 * 揺れる。年として読めるところだけ採る。世紀での書き方（C19）は年に
 * 直せないので捨てる。
 */
export function toBuiltYear(value: string | undefined, thisYear: number): number | null {
  if (!value) return null
  const year = Number(String(value).match(/\d{4}/)?.[0])
  return Number.isInteger(year) && year >= 1850 && year <= thisYear ? year : null
}
