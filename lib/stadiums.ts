/**
 * 球場マスタ。
 *
 * 球場スタンプラリーで「12球団の本拠地をいくつ回ったか」を出すために使う。
 * 外部のAPIは使わない。数が決まっていてほとんど変わらないので、
 * 表を持つほうが速く、費用もかからず、オフラインでも動く。
 *
 * npb.jp の表記はここと揃っていない（全角の Ｆ、全角スペース、略称）。
 * 突き合わせは alias で行い、比較のときは空白を全て落として大文字に寄せる。
 *
 *   ZOZOマリン / エスコンＦ / みずほPayPay / 京セラD大阪 / 神 宮 …
 *
 * 命名権は数年で変わる。変わったら name を直し、alias に古い名前を残す。
 * 古い試合の place は当時の表記のままなので、alias を消すと過去の
 * スタンプが外れる。
 */

export type StadiumKind = 'home' | 'regional'

export type Stadium = {
  id: string
  /** 正式名称に近い表示名 */
  name: string
  /** 一覧で使う短い名前 */
  short: string
  /** 本拠地なら球団ID（lib/constants.ts の OPPONENTS と揃える。ロッテは marines） */
  team: string | null
  kind: StadiumKind
  /** npb.jp や手入力で現れる表記。name と short も暗黙に含む */
  aliases: string[]
}

/** 12球団の本拠地。順はパ・リーグ → セ・リーグ */
export const HOME_STADIUMS: Stadium[] = [
  {
    id: 'zozo',
    name: 'ZOZOマリンスタジアム',
    short: 'ZOZOマリン',
    team: 'marines',
    kind: 'home',
    aliases: ['千葉マリン', 'QVCマリン'],
  },
  {
    id: 'escon',
    name: 'エスコンフィールドHOKKAIDO',
    short: 'エスコンF',
    team: 'fighters',
    kind: 'home',
    aliases: ['エスコンＦ', 'エスコンフィールド', '札幌ドーム'],
  },
  {
    id: 'rakuten_mobile',
    name: '楽天モバイルパーク宮城',
    short: '楽天モバイル',
    team: 'eagles',
    kind: 'home',
    aliases: ['楽天生命パーク', 'Koboパーク宮城'],
  },
  {
    id: 'belluna',
    name: 'ベルーナドーム',
    short: 'ベルーナドーム',
    team: 'lions',
    kind: 'home',
    aliases: ['メットライフドーム', '西武ドーム'],
  },
  {
    id: 'kyocera',
    name: '京セラドーム大阪',
    short: '京セラD大阪',
    team: 'buffaloes',
    kind: 'home',
    aliases: ['大阪ドーム'],
  },
  {
    id: 'mizuho_paypay',
    name: 'みずほPayPayドーム福岡',
    short: 'みずほPayPay',
    team: 'hawks',
    kind: 'home',
    aliases: ['PayPayドーム', '福岡ドーム', 'ヤフオクドーム'],
  },
  {
    id: 'tokyo_dome',
    name: '東京ドーム',
    short: '東京ドーム',
    team: 'giants',
    kind: 'home',
    aliases: [],
  },
  {
    id: 'jingu',
    name: '明治神宮野球場',
    short: '神宮',
    team: 'swallows',
    kind: 'home',
    aliases: ['神 宮', '神宮球場'],
  },
  {
    id: 'yokohama',
    name: '横浜スタジアム',
    short: '横浜',
    team: 'baystars',
    kind: 'home',
    aliases: ['ハマスタ'],
  },
  {
    id: 'vantelin',
    name: 'バンテリンドーム ナゴヤ',
    short: 'バンテリンD',
    team: 'dragons',
    kind: 'home',
    aliases: ['ナゴヤドーム', 'バンテリンドーム'],
  },
  {
    id: 'koshien',
    name: '阪神甲子園球場',
    short: '甲子園',
    team: 'tigers',
    kind: 'home',
    aliases: [],
  },
  {
    id: 'mazda',
    name: 'MAZDA Zoom-Zoom スタジアム広島',
    short: 'マツダスタジアム',
    team: 'carp',
    kind: 'home',
    aliases: ['マツダスタジアム', 'マツダZoom-Zoom'],
  },
]

/**
 * 地方球場。
 *
 * 本拠地ではないが試合が行われる球場。npb.jp の表記で出てきたものを足していく。
 * スタンプの分母（12球団）には数えず、別枠で数える。
 */
export const REGIONAL_STADIUMS: Stadium[] = [
  { id: 'omiya', name: '県営大宮公園野球場', short: '県営大宮', team: null, kind: 'regional', aliases: [] },
  { id: 'kumamoto', name: 'リブワーク藤崎台球場', short: '熊本', team: null, kind: 'regional', aliases: ['熊 本', '藤崎台'] },
  { id: 'maebashi', name: '上毛新聞敷島球場', short: '前橋', team: null, kind: 'regional', aliases: ['前 橋', '敷島'] },
  { id: 'koriyama', name: 'ヨーク開成山スタジアム', short: '郡山', team: null, kind: 'regional', aliases: ['郡 山', '開成山'] },
  { id: 'kagoshima', name: '平和リース球場', short: '鹿児島', team: null, kind: 'regional', aliases: ['鹿児島'] },
]

export const STADIUMS: Stadium[] = [...HOME_STADIUMS, ...REGIONAL_STADIUMS]

/** 突き合わせ用。空白（全角も）を落として大文字に寄せる */
function key(value: string): string {
  return value.replace(/[\s　]+/g, '').toUpperCase()
}

/** 表記のゆれを吸収して球場を引く。知らない球場は null */
export function stadiumOf(place: string): Stadium | null {
  if (!place) return null
  const k = key(place)
  return (
    STADIUMS.find((s) => [s.name, s.short, ...s.aliases].some((n) => key(n) === k)) ?? null
  )
}

export function stadiumById(id: string): Stadium | null {
  return STADIUMS.find((s) => s.id === id) ?? null
}
