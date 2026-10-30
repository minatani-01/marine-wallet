import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  areaText,
  boundsOf,
  buildingAge,
  expandBounds,
  hasFacility,
  hasSameStation,
  nearestFacilities,
  nearestFood,
  ratingText,
  toFoodRating,
  toFacilityKinds,
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
  toBuiltYear,
  straightWalk,
  walkRadius,
  worstWalk,
  type Facility,
  type FoodPlace,
  type RentBuilding,
  type RentStation,
} from '@/lib/rent'
import { facilityKind } from '@/lib/rent-osm'

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
  builtYear: over.builtYear ?? null,
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


/* --------------------------------------------------------- まわりの施設 ---- */

const facility = (over: Partial<Facility> & { lat: number; lng: number }): Facility => ({
  id: over.id ?? 'f',
  kind: over.kind ?? 'convenience',
  name: over.name ?? '店',
  lat: over.lat,
  lng: over.lng,
})

test('施設を探す四角は、建物の四角より広く取る', () => {
  // 範囲のふちに建つ建物は、外にある店がいちばん近いことがある
  const b = { south: 35.64, west: 139.7, north: 35.65, east: 139.71 }
  const wide = expandBounds(b, 900)
  assert.ok(wide.south < b.south && wide.north > b.north)
  assert.ok(wide.west < b.west && wide.east > b.east)
  // 900m ぶん広がっている（緯度は1度=約110.6km）
  assert.ok(Math.abs((b.south - wide.south) * 110574 - 900) < 5)
})

test('種類ごとに、いちばん近い1軒までの分を出す', () => {
  const here = { lat: 35.646, lng: 139.71 }
  const facilities = [
    // 約160m（徒歩2分）
    facility({ id: 'c1', kind: 'convenience', lat: 35.6474, lng: 139.71 }),
    // 約330m（徒歩5分）。近いほうが採られる
    facility({ id: 'c2', kind: 'convenience', lat: 35.649, lng: 139.71 }),
    facility({ id: 'p1', kind: 'pharmacy', lat: 35.649, lng: 139.71 }),
  ]

  const near = nearestFacilities(here, facilities)
  assert.equal(near.convenience, 2)
  assert.equal(near.pharmacy, 5)
  // 無い種類は入れない。「0分」と書くと、すぐそこにあるように見える
  assert.equal(near.dentist, undefined)
  assert.equal(near.clinic, undefined)
  assert.deepEqual(nearestFacilities(here, []), {})
})

test('徒歩◯分以内に「ある」かどうか', () => {
  // 建物は落とさない。あるか無いかを一覧に出すための判定
  const near = { convenience: 2, pharmacy: 6 }

  assert.equal(hasFacility(near, 'convenience', 5), true)
  // 薬局は6分なので、5分以内では「なし」
  assert.equal(hasFacility(near, 'pharmacy', 5), false)
  assert.equal(hasFacility(near, 'pharmacy', 7), true)
  // ちょうどの分は「ある」
  assert.equal(hasFacility(near, 'pharmacy', 6), true)
  // 1軒も無い種類
  assert.equal(hasFacility(near, 'dentist', 10), false)
  // 施設そのものを取れていないとき
  assert.equal(hasFacility(undefined, 'convenience', 5), false)
})

test('覚えておいた施設の条件を読み直す', () => {
  assert.deepEqual(toFacilityKinds(['convenience', 'clinic']), ['convenience', 'clinic'])
  // 並びは決まった順に直す。保存した順で出すと、開くたびに位置が変わる
  assert.deepEqual(toFacilityKinds(['clinic', 'convenience']), ['convenience', 'clinic'])
  // 知らない値は捨てる
  assert.deepEqual(toFacilityKinds(['convenience', 'カフェ']), ['convenience'])
  assert.deepEqual(toFacilityKinds('convenience'), [])
  assert.deepEqual(toFacilityKinds(null), [])
})

test('OSM のタグと名前から施設の種類を決める', () => {
  assert.equal(facilityKind({ shop: 'convenience', name: 'セブン-イレブン' }), 'convenience')
  assert.equal(facilityKind({ amenity: 'pharmacy', name: '〇〇薬局' }), 'pharmacy')
  assert.equal(facilityKind({ shop: 'chemist', name: 'マツモトキヨシ' }), 'pharmacy')
  assert.equal(facilityKind({ amenity: 'dentist', name: '〇〇デンタルクリニック' }), 'dentist')

  // 歯科は名前からも拾う。clinic として入っていることがある
  assert.equal(facilityKind({ amenity: 'clinic', name: '〇〇歯科' }), 'dentist')

  // 内科。日本のクリニックは speciality が入っていないことが多い
  assert.equal(facilityKind({ amenity: 'clinic', name: '〇〇内科クリニック' }), 'clinic')
  assert.equal(facilityKind({ amenity: 'doctors', name: '〇〇医院' }), 'clinic')
  assert.equal(
    facilityKind({ amenity: 'clinic', 'healthcare:speciality': 'internal_medicine' }),
    'clinic'
  )

  // 風邪では行かないところは外す
  assert.equal(facilityKind({ amenity: 'clinic', 'healthcare:speciality': 'dermatology' }), null)
  assert.equal(facilityKind({ amenity: 'clinic', name: '〇〇眼科' }), null)
  assert.equal(facilityKind({ amenity: 'clinic', name: '〇〇整形外科' }), null)
  // 動物病院は人が診てもらえない
  assert.equal(facilityKind({ amenity: 'clinic', name: '〇〇動物病院' }), null)

  // 美容院。shop=beauty はネイルやエステも入るので、髪を切るところだけ
  assert.equal(facilityKind({ shop: 'hairdresser', name: '〇〇美容室' }), 'hairdresser')
  assert.equal(facilityKind({ shop: 'beauty', name: 'ヘアサロン〇〇' }), 'hairdresser')
  assert.equal(facilityKind({ shop: 'beauty', name: '〇〇ネイルサロン' }), null)

  // 住まいや関係ないものは施設にしない
  assert.equal(facilityKind({ building: 'apartments', name: '〇〇マンション' }), null)
  assert.equal(facilityKind({ shop: 'supermarket', name: '〇〇ストア' }), null)
})


/* --------------------------------------------------------------- 飲食店 ---- */

const food = (over: Partial<FoodPlace> & { lat: number; lng: number }): FoodPlace => ({
  id: over.id ?? 'f',
  name: over.name ?? '店',
  rating: over.rating ?? 3.5,
  lat: over.lat,
  lng: over.lng,
})

test('いちばん近い飲食店を出す。星は Google に聞く時点で切ってある', () => {
  const here = { lat: 35.646, lng: 139.71 }
  const foods = [
    // 約330m（徒歩5分）だが評価は高い
    food({ id: 'a', name: '遠いけど高評価', rating: 4.5, lat: 35.649, lng: 139.71 }),
    // 約160m（徒歩2分）
    food({ id: 'b', name: '近い店', rating: 3.2, lat: 35.6474, lng: 139.71 }),
  ]

  const near = nearestFood(here, foods)
  // 近いほうを採る。条件に合う店なら、あとは近さで決まる
  assert.equal(near?.name, '近い店')
  assert.equal(near?.minutes, 2)
  assert.equal(near?.rating, 3.2)

  assert.equal(nearestFood(here, []), null)
})

test('星の書き方と、覚えておいた条件の読み直し', () => {
  // 3 と 3.5 が並ぶので桁をそろえる
  assert.equal(ratingText(3), '★3.0')
  assert.equal(ratingText(3.5), '★3.5')
  assert.equal(ratingText(4), '★4.0')

  assert.equal(toFoodRating(3.5), 3.5)
  assert.equal(toFoodRating(4), 4)
  // 知らない値は既定に戻す
  assert.equal(toFoodRating(4.8), 3)
  assert.equal(toFoodRating('3.5'), 3)
  assert.equal(toFoodRating(undefined), 3)
})


test('同じ駅は2つ入れない', () => {
  // 同じ駅を重ねても、重なりは1つぶんのまま変わらない
  const stations = [station({ ...EBISU, id: 'e', name: '恵比寿駅', minutes: 10 })]

  // 名前が同じ
  assert.equal(hasSameStation(stations, { ...EBISU, name: '恵比寿駅' }), true)
  // 名前が違っても、ごく近い点（別の出口を選んだとき）は同じ駅とみなす
  assert.equal(
    hasSameStation(stations, { lat: EBISU.lat + 0.0005, lng: EBISU.lng, name: '恵比寿駅 西口' }),
    true
  )
  // 別の駅は入る（代官山は約640m離れている）
  assert.equal(hasSameStation(stations, { ...DAIKANYAMA, name: '代官山駅' }), false)
  assert.equal(hasSameStation([], { ...EBISU, name: '恵比寿駅' }), false)
})


test('竣工年を読んで、築何年かを出す', () => {
  // OSM の start_date は書き方が揺れる
  assert.equal(toBuiltYear('1998', 2026), 1998)
  assert.equal(toBuiltYear('1998-04', 2026), 1998)
  assert.equal(toBuiltYear('1998-04-01', 2026), 1998)
  assert.equal(toBuiltYear('~1998', 2026), 1998)
  // 年に直せないものは捨てる
  assert.equal(toBuiltYear('C19', 2026), null)
  assert.equal(toBuiltYear('', 2026), null)
  assert.equal(toBuiltYear(undefined, 2026), null)
  // 先の年や、古すぎるものは入力の間違い
  assert.equal(toBuiltYear('2030', 2026), null)
  assert.equal(toBuiltYear('1700', 2026), null)

  assert.equal(buildingAge(1998, 2026), 28)
  assert.equal(buildingAge(2026, 2026), 0)
  // 分からないものを「築0年」と書くと新築だと思われる
  assert.equal(buildingAge(null, 2026), null)
  assert.equal(buildingAge(undefined, 2026), null)
})
