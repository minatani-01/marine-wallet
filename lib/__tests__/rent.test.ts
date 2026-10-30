import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  areaText,
  boundsOf,
  boundsSpan,
  coverCircles,
  haversine,
  insideAll,
  intersectCircles,
  measureOrder,
  meetsAll,
  mergeBuildings,
  pairGaps,
  rejectRentReason,
  searchArea,
  sortBuildings,
  straightMinutes,
  straightWalk,
  walkRadius,
  worstWalk,
  type RentBuilding,
  type RentStation,
} from '@/lib/rent'

/**
 * 賃貸さがしの計算（0075）。
 *
 * 肝は「全部の駅から歩けるか」の判定。ここが甘いと、片方の駅からしか
 * 歩けない建物が一覧に混ざり、AND で探している意味が無くなる。
 */

/** 恵比寿・代官山あたり。実際の座標に近い値を使う */
const EBISU = { lat: 35.64669, lng: 139.710106 }
const DAIKANYAMA = { lat: 35.648193, lng: 139.703253 }
const IKEBUKURO = { lat: 35.728926, lng: 139.71038 }

const station = (over: Partial<RentStation> & RentPointish): RentStation => ({
  id: over.id ?? 'a',
  name: over.name ?? '駅',
  lat: over.lat,
  lng: over.lng,
  minutes: over.minutes ?? 10,
})

type RentPointish = { lat: number; lng: number; id?: string; name?: string; minutes?: number }

const building = (over: Partial<RentBuilding> & { lat: number; lng: number }): RentBuilding => ({
  id: over.id ?? 'b',
  source: over.source ?? 'osm',
  name: over.name ?? '',
  address: over.address ?? '',
  lat: over.lat,
  lng: over.lng,
  levels: over.levels ?? null,
  kind: over.kind ?? 'マンション・アパート',
  walk: over.walk ?? {},
})

test('直線距離を分に直す。1分は80m', () => {
  assert.equal(straightMinutes(0), 1)
  assert.equal(straightMinutes(80), 1)
  assert.equal(straightMinutes(81), 2)
  assert.equal(straightMinutes(800), 10)
  // 徒歩◯分の半径は、そのまま掛けたもの
  assert.equal(walkRadius(10), 800)
  assert.equal(walkRadius(1), 80)
})

test('恵比寿と代官山の距離は600mほど', () => {
  const d = haversine(EBISU, DAIKANYAMA)
  assert.ok(d > 500 && d < 800, `${d}m`)
})

test('近い2駅なら、どちらからも歩ける範囲が残る', () => {
  const stations = [
    station({ ...EBISU, id: 'e', name: '恵比寿', minutes: 10 }),
    station({ ...DAIKANYAMA, id: 'd', name: '代官山', minutes: 10 }),
  ]
  const area = intersectCircles(stations)
  assert.ok(area, '重なりが出ること')
  assert.ok(area!.areaM2 > 0)

  // 重なりの輪郭は、どちらの駅からも徒歩圏内に収まっている。
  // 輪郭の点は円周の上に乗るので、数mの誤差を見込む（平面に落として
  // 計算しているぶんと、円周どうしがかすめる所を拾うための余裕）
  for (const p of area!.path) {
    for (const s of stations) {
      const over = haversine(s, p) - walkRadius(s.minutes)
      assert.ok(over <= 5, `${s.name}から${over.toFixed(1)}m はみ出した`)
    }
  }
  // 中心（2駅の中間）は確実に中
  assert.equal(
    insideAll({ lat: (EBISU.lat + DAIKANYAMA.lat) / 2, lng: (EBISU.lng + DAIKANYAMA.lng) / 2 }, stations),
    true
  )
})

test('離れた駅どうしでは範囲が残らない', () => {
  const stations = [
    station({ ...EBISU, id: 'e', name: '恵比寿', minutes: 10 }),
    station({ ...IKEBUKURO, id: 'i', name: '池袋', minutes: 10 }),
  ]
  assert.equal(intersectCircles(stations), null)

  // 何分あれば届くのかまで出す。「ありません」だけでは次の手が分からない
  const gaps = pairGaps(stations)
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].a.name, '恵比寿')
  assert.ok(gaps[0].meters > 9000)
  // 9.1km なら、両方から57分ずつ
  assert.ok(gaps[0].needEach > 50 && gaps[0].needEach < 70, String(gaps[0].needEach))
})

test('3駅でも、全部に共通する範囲だけを残す', () => {
  // 恵比寿と代官山は近いが、池袋を足すと共通する範囲は無くなる
  const stations = [
    station({ ...EBISU, id: 'e', minutes: 15 }),
    station({ ...DAIKANYAMA, id: 'd', minutes: 15 }),
    station({ ...IKEBUKURO, id: 'i', minutes: 15 }),
  ]
  assert.equal(intersectCircles(stations), null)
  // 2駅どうしは重なるので、「どの組も届かない」とは言えない
  assert.equal(pairGaps(stations).filter((g) => g.a.id === 'e' && g.b.id === 'd').length, 0)
})

test('駅が1つなら、その駅の円がそのまま範囲になる', () => {
  const one = [station({ ...EBISU, id: 'e', minutes: 10 })]
  const area = searchArea(one)
  assert.ok(area)
  // 半径800mの円の面積（約2.01km²）に近いこと
  const expected = Math.PI * 800 * 800
  assert.ok(Math.abs(area!.areaM2 - expected) / expected < 0.01)
  assert.equal(searchArea([]), null)
})

test('全部の駅から徒歩圏内かを直線距離で見る', () => {
  const stations = [
    station({ ...EBISU, id: 'e', minutes: 5 }),
    station({ ...DAIKANYAMA, id: 'd', minutes: 5 }),
  ]
  // 2駅のちょうど中間は、どちらからも400m以内
  const middle = {
    lat: (EBISU.lat + DAIKANYAMA.lat) / 2,
    lng: (EBISU.lng + DAIKANYAMA.lng) / 2,
  }
  assert.equal(insideAll(middle, stations), true)
  // 恵比寿の真上（代官山からは遠い）は外れる
  assert.equal(insideAll({ lat: EBISU.lat + 0.01, lng: EBISU.lng }, stations), false)
})

test('駅ごとの徒歩分を直線距離から埋める', () => {
  const stations = [
    station({ ...EBISU, id: 'e', minutes: 10 }),
    station({ ...DAIKANYAMA, id: 'd', minutes: 10 }),
  ]
  const walk = straightWalk(EBISU, stations)
  assert.equal(walk.e.minutes, 1)
  assert.equal(walk.e.measured, false)
  assert.ok(walk.d.minutes >= 7 && walk.d.minutes <= 10, String(walk.d.minutes))
})

test('いちばん遠い駅までの分で判断する', () => {
  const stations = [station({ ...EBISU, id: 'e', minutes: 10 }), station({ ...DAIKANYAMA, id: 'd', minutes: 10 })]
  const near = building({
    ...EBISU,
    walk: { e: { minutes: 3, measured: true }, d: { minutes: 9, measured: true } },
  })
  assert.equal(worstWalk(near, stations), 9)
  assert.equal(meetsAll(near, stations), true)

  // 片方だけ超えていたら外す。AND で探しているので、ここが効く
  const far = building({
    ...EBISU,
    walk: { e: { minutes: 3, measured: true }, d: { minutes: 12, measured: true } },
  })
  assert.equal(meetsAll(far, stations), false)

  // 測れていない駅があるものも通さない
  const missing = building({ ...EBISU, walk: { e: { minutes: 3, measured: true } } })
  assert.equal(meetsAll(missing, stations), false)
  assert.equal(worstWalk(missing, stations), Number.POSITIVE_INFINITY)
})

test('名前の分かっている建物を先に並べる', () => {
  const stations = [station({ ...EBISU, id: 'e', minutes: 10 })]
  const items = [
    building({ id: '1', name: '', ...EBISU, walk: { e: { minutes: 2, measured: true } } }),
    building({ id: '2', name: 'Bマンション', ...EBISU, walk: { e: { minutes: 8, measured: true } }, levels: 3 }),
    building({ id: '3', name: 'Aハイツ', ...EBISU, walk: { e: { minutes: 5, measured: true } }, levels: 12 }),
  ]

  // 駅から近い順でも、名前の無い建物は後ろ（調べようがないため）
  assert.deepEqual(
    sortBuildings(items, stations, 'walk').map((b) => b.id),
    ['3', '2', '1']
  )
  assert.deepEqual(
    sortBuildings(items, stations, 'levels').map((b) => b.id),
    ['3', '2', '1']
  )
  assert.deepEqual(
    sortBuildings(items, stations, 'name').map((b) => b.id),
    ['3', '2', '1']
  )
  // 元の配列は変えない
  assert.equal(items[0].id, '1')
})

test('測る順は、いちばん遠い駅までが短いものから', () => {
  const stations = [station({ ...EBISU, id: 'e', minutes: 10 })]
  const items = [
    building({ id: 'far', ...EBISU, walk: { e: { minutes: 9, measured: false } } }),
    building({ id: 'near', ...EBISU, walk: { e: { minutes: 2, measured: false } } }),
  ]
  assert.deepEqual(
    measureOrder(items, stations).map((b) => b.id),
    ['near', 'far']
  )
})

test('名前を聞く円は、範囲の中にだけ置く', () => {
  const stations = [
    station({ ...EBISU, id: 'e', minutes: 10 }),
    station({ ...DAIKANYAMA, id: 'd', minutes: 10 }),
  ]
  const area = searchArea(stations)
  assert.ok(area)

  const circles = coverCircles(area!.path, stations, 400, 6)
  assert.ok(circles.length >= 1 && circles.length <= 6, String(circles.length))
  for (const c of circles) assert.equal(insideAll(c, stations), true)

  // 上限を1にすれば1つだけ。中身が欠けていないことまで見る
  const one = coverCircles(area!.path, stations, 400, 1)
  assert.equal(one.length, 1)
  assert.equal(insideAll(one[0], stations), true)
})

test('狭い範囲でも、真ん中を1回は聞く', () => {
  const stations = [
    station({ ...EBISU, id: 'e', minutes: 1 }),
    station({ ...EBISU, id: 'e2', minutes: 1 }),
  ]
  const area = searchArea(stations)
  assert.ok(area)
  assert.equal(coverCircles(area!.path, stations, 400, 6).length, 1)
})

test('OSM の輪郭に、近くの Google の名前を寄せる', () => {
  const stations = [station({ ...EBISU, id: 'e', minutes: 10 })]
  const osm = [
    building({ id: 'osm-1', source: 'osm', name: '', lat: 35.6467, lng: 139.7101, levels: 8 }),
    building({ id: 'osm-2', source: 'osm', name: '元からある名前', lat: 35.648, lng: 139.712 }),
  ]
  const google = [
    // 20mほどしか離れていないので、同じ建物とみなす
    building({ id: 'g-1', source: 'google', name: 'グランド恵比寿', lat: 35.64672, lng: 139.71012 }),
    // 名前の付いた輪郭に重なるものは、二重に並べない
    building({ id: 'g-2', source: 'google', name: '別名', lat: 35.648, lng: 139.712 }),
    // どの輪郭からも遠いので、そのまま足す
    building({ id: 'g-3', source: 'google', name: '離れたマンション', lat: 35.6455, lng: 139.7085 }),
  ]

  const merged = mergeBuildings(osm, google)
  assert.equal(merged.length, 3)
  assert.equal(merged[0].name, 'グランド恵比寿')
  // 階数は輪郭のものが残る（Google は階数を持たない）
  assert.equal(merged[0].levels, 8)
  assert.equal(merged[1].name, '元からある名前')
  assert.equal(merged[2].id, 'g-3')

  // 元の配列は変えない
  assert.equal(osm[0].name, '')
  void stations
})

test('範囲の四角と、その広さ', () => {
  const b = boundsOf([
    { lat: 35.64, lng: 139.7 },
    { lat: 35.65, lng: 139.71 },
  ])
  assert.deepEqual(b, { south: 35.64, west: 139.7, north: 35.65, east: 139.71 })
  assert.ok(boundsSpan(b!) > 1000)
  assert.equal(boundsOf([]), null)

  assert.equal(areaText(5000), '約5,000m²')
  assert.equal(areaText(50000), '約5.0ha')
  assert.equal(areaText(2_010_619), '約2.01km²')
})

test('入力を確かめる', () => {
  assert.match(String(rejectRentReason([])), /駅/)
  assert.equal(rejectRentReason([station({ ...EBISU, minutes: 10 })]), null)
  assert.match(String(rejectRentReason([station({ ...EBISU, minutes: 0 })])), /徒歩時間/)
  assert.match(String(rejectRentReason([station({ ...EBISU, minutes: 31 })])), /徒歩時間/)
  assert.match(String(rejectRentReason([station({ ...EBISU, minutes: 1.5 })])), /徒歩時間/)
  assert.match(
    String(rejectRentReason([station({ lat: Number.NaN, lng: 139.7, minutes: 10 })])),
    /場所/
  )
  assert.match(
    String(
      rejectRentReason(
        Array.from({ length: 6 }, (_, i) => station({ ...EBISU, id: `s${i}`, minutes: 10 }))
      )
    ),
    /最大/
  )
})
