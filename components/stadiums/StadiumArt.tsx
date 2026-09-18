import type { StadiumShape } from '@/lib/stadiums'

/**
 * 券面の球場の絵。
 *
 * 球場ごとに描き分ける。ドーム／屋根なしの型だけで描くと、12球場が同じ絵に
 * なってしまい、券を並べたときにどこの球場か分からない。実物で目印になる形
 * ——エスコンの傾いた切妻、楽天モバイルの観覧車、ベルーナの浮いた屋根、
 * 甲子園の銀傘——を1本ずつ線にする。
 *
 * 大きさは 120 x 52、地面は y=44 に揃える。線だけなので、訪問前はそのまま
 * 薄く沈められる。知らない球場（地方球場や新設）は型で描く。
 */

/** 球場ごとの線。key は lib/stadiums.ts の Stadium.id */
const ART: Record<string, React.ReactNode> = {
  // ZOZOマリン：海風よけの大きな庇と、外野まで続く低いスタンド
  zozo: (
    <>
      <path d="M18 44l8-11h68l8 11" />
      <path d="M26 37h68" />
      <path d="M14 25q46-10 92 0" />
      <path d="M14 25v8M106 25v8" />
      <path d="M34 21.5v-4M60 20v-4M86 21.5v-4" />
    </>
  ),

  // エスコンフィールド：片流れに見える大きな切妻屋根とガラス面
  escon: (
    <>
      <path d="M12 44V29l48-17 48 14v18" />
      <path d="M12 29h96" />
      <path d="M60 12v17M36 20v9M84 20.5v8.5" />
    </>
  ),

  // 楽天モバイルパーク：スタンドの外に立つ観覧車
  rakuten_mobile: (
    <>
      <path d="M10 44l10-12h58l10 12" />
      <path d="M20 38h58" />
      <path d="M26 32V21M72 32V21" />
      <path d="M22 21h8M68 21h8" />
      <circle cx="100" cy="26" r="9" />
      <path d="M100 17v18M91 26h18M94 20l12 12M106 20l-12 12" />
      <path d="M97 34l3 10M103 34l-3 10" />
    </>
  ),

  // ベルーナドーム：柱で持ち上がった屋根と、その下の吹き抜け
  belluna: (
    <>
      <path d="M22 44v-10h76v10" />
      <path d="M22 38h76" />
      <path d="M10 27q50-17 100 0" />
      <path d="M17 24.5q43-12 86 0" />
      <path d="M24 22.5v11.5M46 19.5v14.5M74 19.5v14.5M96 22.5v11.5" />
    </>
  ),

  // 京セラドーム大阪：平たい円盤を載せた銀色のドーム
  kyocera: (
    <>
      <path d="M14 44v-8h92v8" />
      <path d="M14 36a46 20 0 0 1 92 0" />
      <path d="M46 19a14 4 0 1 0 28 0a14 4 0 1 0-28 0" />
      <path d="M46 19v-3M74 19v-3" />
    </>
  ),

  // みずほPayPayドーム：三枚が重なって開く丸屋根
  mizuho_paypay: (
    <>
      <path d="M16 44v-8h88v8" />
      <path d="M16 36a44 26 0 0 1 88 0" />
      <path d="M26 36a34 20 0 0 1 68 0" />
      <path d="M38 36a22 13 0 0 1 44 0" />
    </>
  ),

  // 東京ドーム：低くふくらんだ膜屋根
  tokyo_dome: (
    <>
      <path d="M12 44v-8h96v8" />
      <path d="M12 36q48-30 96 0" />
      <path d="M22 31q38-19 76 0" />
    </>
  ),

  // 神宮：バックネット裏だけの庇と、外野の大きな得点板
  jingu: (
    <>
      <path d="M8 44l10-12h66l8 12" />
      <path d="M18 38h66" />
      <path d="M12 26q30-5 60-1" />
      <path d="M14 26v6M70 25v7" />
      <path d="M90 17h22v15H90z" />
      <path d="M95 32v12M107 32v12" />
    </>
  ),

  // 横浜スタジアム：まるい擂り鉢と、ぐるりと立つ照明
  yokohama: (
    <>
      <path d="M10 44q0-14 50-14t50 14" />
      <path d="M28 44q0-7 32-7t32 7" />
      <path d="M20 39V27M100 39V27" />
      <path d="M16 27h8M96 27h8" />
    </>
  ),

  // バンテリンドーム ナゴヤ：帯の通ったドームと頂部の小窓
  vantelin: (
    <>
      <path d="M14 44v-9h92v9" />
      <path d="M14 35a46 23 0 0 1 92 0" />
      <path d="M21 26h78" />
      <path d="M53 14a7 2.5 0 1 0 14 0a7 2.5 0 1 0-14 0" />
    </>
  ),

  // 甲子園：内野を覆う銀傘と、外野まで続く土のスタンド
  koshien: (
    <>
      <path d="M10 44l10-13h80l10 13" />
      <path d="M20 37h80" />
      <path d="M12 23q34-9 68-4" />
      <path d="M14 23v8M78 19.5v11.5" />
      <path d="M94 31V21" />
      <path d="M89 21h10" />
    </>
  ),

  // マツダスタジアム：片側だけに架かる大きな傾いた屋根
  mazda: (
    <>
      <path d="M10 44l10-12h84l6 12" />
      <path d="M20 38h84" />
      <path d="M12 18q32 2 60 8" />
      <path d="M14 18v14M70 26v6" />
      <path d="M92 32V20" />
      <path d="M87 20h10" />
    </>
  ),
}

/** 知らない球場のときの型。地方球場はこちらで描く */
const FALLBACK: Record<StadiumShape, React.ReactNode> = {
  dome: (
    <>
      <path d="M16 44V34a44 22 0 0 1 88 0v10" />
      <path d="M33 44v-7h13v7M53.5 44v-7h13v7M74 44v-7h13v7" />
    </>
  ),
  roof: (
    <>
      <path d="M16 44V34a44 22 0 0 1 28-19.5" />
      <path d="M104 44V34a44 22 0 0 0-28-19.5" />
      <path d="M46 13.5h28" strokeDasharray="3 4" />
      <path d="M33 44v-7h13v7M53.5 44v-7h13v7M74 44v-7h13v7" />
    </>
  ),
  // 屋根なしの球場。バックネットと照明塔で球場らしさを出す
  open: (
    <>
      <path d="M14 44l10-12h72l10 12" />
      <path d="M24 38h72" />
      <path d="M44 32v-9h32v9" />
      <path d="M52 32v-9M60 32v-9M68 32v-9" />
      <path d="M32 32V21M88 32V21" />
      <path d="M28 21h8M84 21h8" />
    </>
  ),
}

export default function StadiumArt({
  id,
  shape,
  className = '',
}: {
  /** lib/stadiums.ts の Stadium.id */
  id: string
  /** id に絵が無いときの型 */
  shape: StadiumShape
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 120 52"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ART[id] ?? FALLBACK[shape]}
      <path d="M6 44h108" />
    </svg>
  )
}
