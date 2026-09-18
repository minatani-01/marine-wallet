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
 *
 * パスポートの券面に出す文字（英名・都道府県・地方・差し色・外観）も
 * ここに置く。スタンプの絵は球場ごとに描かず、外観の型（ドーム／屋根付き／
 * 屋根なし）で描き分ける。
 */

export type StadiumKind = 'home' | 'regional'

/** 券面の絵。実際の外観に合わせて3種類だけ持つ */
export type StadiumShape = 'dome' | 'roof' | 'open'

export type Stadium = {
  id: string
  /** 正式名称に近い表示名 */
  name: string
  /** 一覧で使う短い名前 */
  short: string
  /** 券面の英名 */
  nameEn: string
  /** 所在地 */
  prefecture: string
  prefectureEn: string
  /** 券面の縦書きに使う地方名 */
  regionEn: string
  /** 本拠地なら球団ID（lib/constants.ts の OPPONENTS と揃える。ロッテは marines） */
  team: string | null
  kind: StadiumKind
  shape: StadiumShape
  /** 券面の差し色。暗い背景で読める明るさに寄せた球団カラー */
  accent: string
  /** npb.jp や手入力で現れる表記。name と short も暗黙に含む */
  aliases: string[]
}

/** 12球団の本拠地。順はパ・リーグ → セ・リーグ */
export const HOME_STADIUMS: Stadium[] = [
  {
    id: 'zozo',
    name: 'ZOZOマリンスタジアム',
    short: 'ZOZOマリン',
    nameEn: 'ZOZO MARINE STADIUM',
    prefecture: '千葉',
    prefectureEn: 'CHIBA',
    regionEn: 'KANTO',
    team: 'marines',
    kind: 'home',
    shape: 'open',
    accent: '#22d3ee',
    aliases: ['千葉マリン', 'QVCマリン'],
  },
  {
    id: 'escon',
    name: 'エスコンフィールドHOKKAIDO',
    short: 'エスコンF',
    nameEn: 'ES CON FIELD HOKKAIDO',
    prefecture: '北海道',
    prefectureEn: 'HOKKAIDO',
    regionEn: 'HOKKAIDO',
    team: 'fighters',
    kind: 'home',
    shape: 'roof',
    accent: '#5aa9de',
    aliases: ['エスコンＦ', 'エスコンフィールド', '札幌ドーム'],
  },
  {
    id: 'rakuten_mobile',
    name: '楽天モバイルパーク宮城',
    short: '楽天モバイル',
    nameEn: 'RAKUTEN MOBILE PARK',
    prefecture: '宮城',
    prefectureEn: 'MIYAGI',
    regionEn: 'TOHOKU',
    team: 'eagles',
    kind: 'home',
    shape: 'open',
    accent: '#e05f70',
    aliases: ['楽天生命パーク', 'Koboパーク宮城'],
  },
  {
    id: 'belluna',
    name: 'ベルーナドーム',
    short: 'ベルーナドーム',
    nameEn: 'BELLUNA DOME',
    prefecture: '埼玉',
    prefectureEn: 'SAITAMA',
    regionEn: 'KANTO',
    team: 'lions',
    kind: 'home',
    shape: 'roof',
    accent: '#6b8fe0',
    aliases: ['メットライフドーム', '西武ドーム'],
  },
  {
    id: 'kyocera',
    name: '京セラドーム大阪',
    short: '京セラD大阪',
    nameEn: 'KYOCERA DOME OSAKA',
    prefecture: '大阪',
    prefectureEn: 'OSAKA',
    regionEn: 'KANSAI',
    team: 'buffaloes',
    kind: 'home',
    shape: 'dome',
    accent: '#d8ac55',
    aliases: ['大阪ドーム'],
  },
  {
    id: 'mizuho_paypay',
    name: 'みずほPayPayドーム福岡',
    short: 'みずほPayPay',
    nameEn: 'MIZUHO PAYPAY DOME',
    prefecture: '福岡',
    prefectureEn: 'FUKUOKA',
    regionEn: 'KYUSHU',
    team: 'hawks',
    kind: 'home',
    shape: 'dome',
    accent: '#f2ca4d',
    aliases: ['PayPayドーム', '福岡ドーム', 'ヤフオクドーム'],
  },
  {
    id: 'tokyo_dome',
    name: '東京ドーム',
    short: '東京ドーム',
    nameEn: 'TOKYO DOME',
    prefecture: '東京',
    prefectureEn: 'TOKYO',
    regionEn: 'KANTO',
    team: 'giants',
    kind: 'home',
    shape: 'dome',
    accent: '#ef9450',
    aliases: [],
  },
  {
    id: 'jingu',
    name: '明治神宮野球場',
    short: '神宮',
    nameEn: 'MEIJI JINGU STADIUM',
    prefecture: '東京',
    prefectureEn: 'TOKYO',
    regionEn: 'KANTO',
    team: 'swallows',
    kind: 'home',
    shape: 'open',
    accent: '#a8cf5e',
    aliases: ['神 宮', '神宮球場'],
  },
  {
    id: 'yokohama',
    name: '横浜スタジアム',
    short: '横浜',
    nameEn: 'YOKOHAMA STADIUM',
    prefecture: '神奈川',
    prefectureEn: 'KANAGAWA',
    regionEn: 'KANTO',
    team: 'baystars',
    kind: 'home',
    shape: 'open',
    accent: '#4aa3e0',
    aliases: ['ハマスタ'],
  },
  {
    id: 'vantelin',
    name: 'バンテリンドーム ナゴヤ',
    short: 'バンテリンD',
    nameEn: 'VANTELIN DOME NAGOYA',
    prefecture: '愛知',
    prefectureEn: 'AICHI',
    regionEn: 'TOKAI',
    team: 'dragons',
    kind: 'home',
    shape: 'dome',
    accent: '#5f86e6',
    aliases: ['ナゴヤドーム', 'バンテリンドーム'],
  },
  {
    id: 'koshien',
    name: '阪神甲子園球場',
    short: '甲子園',
    nameEn: 'KOSHIEN STADIUM',
    prefecture: '兵庫',
    prefectureEn: 'HYOGO',
    regionEn: 'KANSAI',
    team: 'tigers',
    kind: 'home',
    shape: 'open',
    accent: '#edd75a',
    aliases: [],
  },
  {
    id: 'mazda',
    name: 'MAZDA Zoom-Zoom スタジアム広島',
    short: 'マツダスタジアム',
    nameEn: 'MAZDA ZOOM-ZOOM STADIUM',
    prefecture: '広島',
    prefectureEn: 'HIROSHIMA',
    regionEn: 'CHUGOKU',
    team: 'carp',
    kind: 'home',
    shape: 'open',
    accent: '#ef5b68',
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
  {
    id: 'omiya',
    name: '県営大宮公園野球場',
    short: '県営大宮',
    nameEn: 'OMIYA PARK STADIUM',
    prefecture: '埼玉',
    prefectureEn: 'SAITAMA',
    regionEn: 'KANTO',
    team: null,
    kind: 'regional',
    shape: 'open',
    accent: '#8fa8bd',
    aliases: [],
  },
  {
    id: 'kumamoto',
    name: 'リブワーク藤崎台球場',
    short: '熊本',
    nameEn: 'FUJISAKIDAI STADIUM',
    prefecture: '熊本',
    prefectureEn: 'KUMAMOTO',
    regionEn: 'KYUSHU',
    team: null,
    kind: 'regional',
    shape: 'open',
    accent: '#8fa8bd',
    aliases: ['熊 本', '藤崎台'],
  },
  {
    id: 'maebashi',
    name: '上毛新聞敷島球場',
    short: '前橋',
    nameEn: 'SHIKISHIMA STADIUM',
    prefecture: '群馬',
    prefectureEn: 'GUNMA',
    regionEn: 'KANTO',
    team: null,
    kind: 'regional',
    shape: 'open',
    accent: '#8fa8bd',
    aliases: ['前 橋', '敷島'],
  },
  {
    id: 'koriyama',
    name: 'ヨーク開成山スタジアム',
    short: '郡山',
    nameEn: 'KAISEIZAN STADIUM',
    prefecture: '福島',
    prefectureEn: 'FUKUSHIMA',
    regionEn: 'TOHOKU',
    team: null,
    kind: 'regional',
    shape: 'open',
    accent: '#8fa8bd',
    aliases: ['郡 山', '開成山'],
  },
  {
    id: 'kagoshima',
    name: '平和リース球場',
    short: '鹿児島',
    nameEn: 'HEIWA LEASE STADIUM',
    prefecture: '鹿児島',
    prefectureEn: 'KAGOSHIMA',
    regionEn: 'KYUSHU',
    team: null,
    kind: 'regional',
    shape: 'open',
    accent: '#8fa8bd',
    aliases: ['鹿児島'],
  },
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
