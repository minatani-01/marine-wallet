import type { ReactNode } from 'react'
import type { StadiumShape } from '@/lib/stadiums'

/**
 * 券面の球場の絵。
 *
 * 球場ごとに描き分ける。線だけの記号ではなく、すり鉢のスタンド・グラウンド・
 * 内野の土・屋根の厚みまで面で置き、少し見下ろした角度で描く。写真は使わない
 * （権利の要る素材を17球場ぶん抱えることになり、通信も増える）。色は券の差し色
 * 一色の濃淡で作るので、どの球場でも券全体の色と喧嘩しない。
 *
 * 大きさは 160 x 100。スタンドの外縁は cy=52 rx=64 ry=22、グラウンドは
 * cy=54 rx=44 ry=13 に揃えてある。屋根を差し替えれば球場ごとの違いが出る。
 * 知らない球場（地方球場や新設）は共通の型で描く。
 */

/**
 * 繰り返す線はここにまとめる。角度から座標を出して並べたもので、
 * 手で書くと1本ずれても気付けない。
 */
/** 放射状の通路（内野の縁からスタンドの外縁へ） */
const AISLES =
  'M123.2 56.5L142.8 56.3M116.6 61.2L133.2 64.2M104.4 64.8L115.6 70.3M88.6 66.8L92.5 73.6M71.4 66.8L67.5 73.6M55.6 64.8L44.4 70.3M43.4 61.2L26.8 64.2M36.8 56.5L17.2 56.3M36.8 51.5L17.2 47.7M43.4 46.8L26.8 39.8M55.6 43.2L44.4 33.7M71.4 41.2L67.5 30.4M88.6 41.2L92.5 30.4M104.4 43.2L115.6 33.7M116.6 46.8L133.2 39.8M123.2 51.5L142.8 47.7'

/** 外壁の柱 */
const PILLARS =
  'M143.4 55.1v11M138.3 61.1v11M128.4 66.4v11M114.7 70.5v11M98.1 73.1v11M80 74v11M61.9 73.1v11M45.3 70.5v11M31.6 66.4v11M21.7 61.1v11M16.6 55.1v11'

/** 入場ゲート */
const GATES =
  'M126 77.1v-4a3 4 0 0 1 6 0v4M98.9 83.7v-4a3 4 0 0 1 6 0v4M55.1 83.7v-4a3 4 0 0 1 6 0v4M28 77.1v-4a3 4 0 0 1 6 0v4'

/** 屋根のリブ（一周ぶん） */
const RIBS_FULL =
  'M124.4 49.6L143.8 50M112.5 55.9L126.7 60.3M91.9 59.5L97.1 66.2M68.1 59.5L62.9 66.2M47.5 55.9L33.3 60.3M35.6 49.6L16.2 50M35.6 42.4L16.2 38M47.5 36.1L33.3 27.7M68.1 32.5L62.9 21.8M91.9 32.5L97.1 21.8M112.5 36.1L126.7 27.7M124.4 42.4L143.8 38'

/** 屋根のリブ（奥側だけ） */
const RIBS_BACK =
  'M34 46L14 44M40.2 39L22.8 32.5M57 33.9L47 24.1M80 32L80 21M103 33.9L113 24.1M119.8 39L137.2 32.5M126 46L146 44'

/** ドームの経線 */
const DOME_MERIDIANS =
  'M80 14Q123.3 31.8 140.1 59.5M80 14Q106.4 37 116.7 70M80 14Q53.6 37 43.3 70M80 14Q36.7 31.8 19.9 59.5'

/** スタンドの外壁。すり鉢の厚みと、柱・ゲートを出す */
function Wall() {
  return (
    <>
      <path d="M16 52v11a64 22 0 0 0 128 0V52" fill="currentColor" fillOpacity="0.12" />
      <path d="M16 63a64 22 0 0 0 128 0" />
      <path d="M16 52v11M144 52v11" />
      <path d="M16 57.5a64 22 0 0 0 128 0" strokeWidth="0.6" opacity="0.35" />
      <g strokeWidth="0.6" opacity="0.45">
        <path d={PILLARS} />
      </g>
      <g strokeWidth="0.7" opacity="0.6">
        <path d={GATES} />
      </g>
    </>
  )
}

/** 座席。上段・コンコース・下段の3層と、段と通路 */
function Stands() {
  return (
    <>
      <path
        fillRule="evenodd"
        fill="currentColor"
        fillOpacity="0.17"
        d="M144 52a64 22 0 1 1-128 0 64 22 0 1 1 128 0ZM135 52.7a55 18 0 1 0-110 0 55 18 0 1 0 110 0Z"
      />
      <path
        fillRule="evenodd"
        fill="currentColor"
        fillOpacity="0.06"
        d="M135 52.7a55 18 0 1 1-110 0 55 18 0 1 1 110 0ZM130 53.2a50 16 0 1 0-100 0 50 16 0 1 0 100 0Z"
      />
      <path
        fillRule="evenodd"
        fill="currentColor"
        fillOpacity="0.15"
        d="M130 53.2a50 16 0 1 1-100 0 50 16 0 1 1 100 0ZM124 54a44 13 0 1 0-88 0 44 13 0 1 0 88 0Z"
      />
      <ellipse cx="80" cy="52" rx="64" ry="22" />
      <ellipse cx="80" cy="52.7" rx="55" ry="18" strokeWidth="0.9" opacity="0.7" />
      <ellipse cx="80" cy="53.2" rx="50" ry="16" strokeWidth="0.8" opacity="0.5" />
      <ellipse cx="80" cy="54" rx="44" ry="13" />
      {/* 座席の段 */}
      <g strokeWidth="0.45" opacity="0.35">
        <ellipse cx="80" cy="52.2" rx="61" ry="20.8" />
        <ellipse cx="80" cy="52.4" rx="58" ry="19.4" />
        <ellipse cx="80" cy="53.5" rx="47" ry="14.5" />
      </g>
      <g strokeWidth="0.55" opacity="0.45">
        <path d={AISLES} />
      </g>
    </>
  )
}

/** グラウンド。芝の刈り跡・ウォーニングトラック・内野の土・塁 */
function Field() {
  return (
    <>
      <ellipse cx="80" cy="54" rx="44" ry="13" fill="currentColor" fillOpacity="0.1" />
      <g strokeWidth="0.45" opacity="0.25">
        <ellipse cx="80" cy="54" rx="38" ry="11" />
        <ellipse cx="80" cy="54" rx="30" ry="8.5" />
      </g>
      <ellipse cx="80" cy="54" rx="41.5" ry="12" strokeWidth="0.55" opacity="0.45" />
      <path d="M58 64A24 12 0 0 1 102 64Z" fill="currentColor" fillOpacity="0.22" stroke="none" />
      <path d="M58 64A24 12 0 0 1 102 64" strokeWidth="0.55" opacity="0.6" />
      <g strokeWidth="0.75" opacity="0.9">
        <path d="M80 65.5 93 60.5 80 55.5 67 60.5z" />
      </g>
      <g strokeWidth="0.6" opacity="0.6">
        <path d="M80 65.5 40 54M80 65.5 120 54" />
      </g>
      <circle cx="80" cy="60.5" r="1.8" strokeWidth="0.6" opacity="0.8" />
      <path d="M77 66.4a3.2 1.6 0 0 1 6 0" strokeWidth="0.55" opacity="0.8" />
    </>
  )
}

/** すり鉢（外壁＋座席帯） */
function Bowl() {
  return (
    <>
      <Wall />
      <Stands />
    </>
  )
}

/** 照明塔 */

function Tower({ x, y }: { x: number; y: number }) {
  return (
    <g strokeWidth="1.1">
      <path d={`M${x} ${y}v-15`} />
      <path d={`M${x - 6} ${y - 15}h12`} />
      <path d={`M${x - 5} ${y - 18}h10`} />
    </g>
  )
}

/** ドームの屋根。下はすり鉢の外壁 */
function Dome({ children }: { children?: ReactNode }) {
  return (
    <>
      <Wall />
      <path d="M16 52C16 27 44 14 80 14s64 13 64 38" fill="currentColor" fillOpacity="0.16" />
      <path d="M16 52C16 27 44 14 80 14s64 13 64 38" />
      <path d="M16 52a64 22 0 0 0 128 0" strokeWidth="0.9" opacity="0.5" />
      <g strokeWidth="0.45" opacity="0.28">
        <path d={DOME_MERIDIANS} />
      </g>
      {children}
    </>
  )
}

/**
 * スタンドの上にかかる屋根。
 * full なら一周、そうでなければ奥側（バックネット裏〜内野）だけ。
 */
function Canopy({ full = false }: { full?: boolean }) {
  return full ? (
    <>
      <path
        fillRule="evenodd"
        fill="currentColor"
        fillOpacity="0.2"
        d="M146 44a66 23 0 1 1-132 0 66 23 0 1 1 132 0ZM126 46a46 14 0 1 0-92 0 46 14 0 1 0 92 0Z"
      />
      <ellipse cx="80" cy="44" rx="66" ry="23" />
      <ellipse cx="80" cy="46" rx="46" ry="14" />
      <g strokeWidth="0.5" opacity="0.4">
        <path d={RIBS_FULL} />
      </g>
    </>
  ) : (
    <>
      <path
        fill="currentColor"
        fillOpacity="0.2"
        d="M14 44a66 23 0 0 1 132 0l-20 2a46 14 0 0 0-92 0z"
      />
      <path d="M14 44a66 23 0 0 1 132 0" />
      <path d="M34 46a46 14 0 0 1 92 0" />
      <path d="M14 44l20 2M146 44l-20 2" />
      <g strokeWidth="0.5" opacity="0.4">
        <path d={RIBS_BACK} />
      </g>
    </>
  )
}

/** 球場ごとの絵。key は lib/stadiums.ts の Stadium.id */
const ART: Record<string, ReactNode> = {
  // ZOZOマリン：スタンドを一周する屋根。海風が強いので庇が深い
  zozo: (
    <>
      <Bowl />
      <Field />
      <Canopy full />
      <g strokeWidth="1" opacity="0.8">
        <path d="M80 21v-5M34 34v-4M126 34v-4M48 64v4M112 64v4" />
      </g>
    </>
  ),

  // エスコンフィールド：切妻の大屋根とガラス面。球場全体が建物の中にある
  escon: (
    <>
      {/* 建物。丸いすり鉢ではなく四角い箱の中に球場がある */}
      <path d="M14 50 94 68v12L14 62z" fill="currentColor" fillOpacity="0.1" />
      <path d="M94 68 146 42v12L94 80z" fill="currentColor" fillOpacity="0.16" />
      <path d="M14 50 94 68 146 42" />
      <path d="M14 50v12l80 18 52-26V42" />
      <path d="M94 68v12" strokeWidth="0.8" opacity="0.6" />
      <g strokeWidth="0.6" opacity="0.45">
        <path d="M34 54.5v12M54 59v12M74 63.5v12M107 61.5v12M120 55v12M133 48.5v12" />
      </g>
      {/* 切妻の大屋根 */}
      <path d="M14 50 94 68 120 43 40 25z" fill="currentColor" fillOpacity="0.2" />
      <path d="M40 25 120 43 146 42 66 24z" fill="currentColor" fillOpacity="0.1" />
      <path d="M14 50 40 25 66 24z" fill="currentColor" fillOpacity="0.14" />
      <path d="M94 68 120 43 146 42z" fill="currentColor" fillOpacity="0.14" />
      <path d="M14 50 94 68 120 43 40 25zM40 25 66 24 146 42 120 43" />
      <g strokeWidth="0.6" opacity="0.5">
        <path d="M22.7 44.1 102.7 62.1M31.3 34.6 111.3 52.6M40.4 55.9 66.4 30.9M66.8 61.9 92.8 36.9" />
      </g>
    </>
  ),

  // 楽天モバイルパーク：観覧車。スタンドの上には内野を覆う屋根
  rakuten_mobile: (
    <>
      <Bowl />
      <Field />
      <Canopy />
      <g strokeWidth="1">
        <circle cx="142" cy="22" r="11" fill="currentColor" fillOpacity="0.12" />
        <path d="M142 11v22M131 22h22M134 14l16 16M150 14l-16 16" />
        <path d="M138 31l4 12M146 31l-4 12" />
      </g>
    </>
  ),

  // ベルーナドーム：柱で持ち上がった屋根。壁が無く、下は吹き抜け
  belluna: (
    <>
      <Bowl />
      <Field />
      <path d="M12 34a68 24 0 0 1 136 0" fill="currentColor" fillOpacity="0.18" />
      <ellipse cx="80" cy="34" rx="68" ry="24" fill="currentColor" fillOpacity="0.14" />
      <ellipse cx="80" cy="34" rx="68" ry="24" />
      <ellipse cx="80" cy="30" rx="30" ry="10" strokeWidth="0.9" opacity="0.6" />
      <g strokeWidth="1.1">
        <path d="M13 37v9M147 37v9M46 55v7M114 55v7" />
      </g>
    </>
  ),

  // 京セラドーム大阪：平たい円盤を載せた丸屋根
  kyocera: (
    <Dome>
      <ellipse cx="80" cy="18" rx="20" ry="6" fill="currentColor" fillOpacity="0.22" />
      <ellipse cx="80" cy="18" rx="20" ry="6" />
      <path d="M22 46a58 30 0 0 1 116 0" strokeWidth="0.9" opacity="0.65" />
      <path d="M40 32a40 20 0 0 1 80 0" strokeWidth="0.9" opacity="0.45" />
    </Dome>
  ),

  // みずほPayPayドーム：三枚が重なって開く丸屋根
  mizuho_paypay: (
    <Dome>
      <path d="M26 52a54 32 0 0 1 108 0" strokeWidth="1" opacity="0.8" />
      <path d="M40 52a40 24 0 0 1 80 0" strokeWidth="1" opacity="0.6" />
      <path d="M56 52a24 15 0 0 1 48 0" strokeWidth="1" opacity="0.45" />
    </Dome>
  ),

  // 東京ドーム：空気で膨らんだ膜屋根。縫い目がうっすら見える
  tokyo_dome: (
    <Dome>
      <path d="M24 47a56 28 0 0 1 112 0" strokeWidth="0.9" opacity="0.5" />
      <path d="M44 34a36 17 0 0 1 72 0" strokeWidth="0.9" opacity="0.38" />
    </Dome>
  ),

  // 神宮：バックネット裏の屋根と、外野の大きな得点板
  jingu: (
    <>
      <Bowl />
      <Field />
      <Canopy />
      <path d="M62 28h36v13H62z" fill="currentColor" fillOpacity="0.2" />
      <path d="M62 28h36v13H62z" />
      <path d="M68 41v5M92 41v5" strokeWidth="1" />
      <Tower x={30} y={60} />
      <Tower x={130} y={60} />
    </>
  ),

  // 横浜スタジアム：まるいすり鉢と、縁をぐるりと囲む照明
  yokohama: (
    <>
      <Bowl />
      <Field />
      <path
        fill="currentColor"
        fillOpacity="0.16"
        d="M18 46a64 22 0 0 1 124 0l-18 2a46 14 0 0 0-88 0z"
      />
      <path d="M18 46a64 22 0 0 1 124 0" />
      <path d="M36 48a46 14 0 0 1 88 0" strokeWidth="1" />
      <Tower x={22} y={56} />
      <Tower x={138} y={56} />
      <Tower x={80} y={30} />
    </>
  ),

  // バンテリンドーム ナゴヤ：帯の通った丸屋根と頂部の小窓
  vantelin: (
    <Dome>
      <path d="M20 44a60 26 0 0 0 120 0" strokeWidth="0.9" opacity="0.55" />
      <path d="M32 30a48 20 0 0 1 96 0" strokeWidth="0.9" opacity="0.45" />
      <ellipse cx="80" cy="16" rx="10" ry="3.4" fill="currentColor" fillOpacity="0.22" />
      <ellipse cx="80" cy="16" rx="10" ry="3.4" strokeWidth="1" />
    </Dome>
  ),

  // 甲子園：内野を覆う銀傘。外壁は蔦におおわれている
  koshien: (
    <>
      <Bowl />
      <Field />
      <Canopy />
      <g fill="currentColor" fillOpacity="0.3" stroke="none">
        <circle cx="22" cy="60" r="1.6" />
        <circle cx="30" cy="66" r="1.6" />
        <circle cx="42" cy="71" r="1.6" />
        <circle cx="55" cy="75" r="1.6" />
        <circle cx="68" cy="77.5" r="1.6" />
        <circle cx="82" cy="78.5" r="1.6" />
        <circle cx="96" cy="77" r="1.6" />
        <circle cx="109" cy="74" r="1.6" />
        <circle cx="121" cy="69" r="1.6" />
        <circle cx="132" cy="63" r="1.6" />
        <circle cx="26" cy="70" r="1.3" />
        <circle cx="48" cy="80" r="1.3" />
        <circle cx="75" cy="85" r="1.3" />
        <circle cx="103" cy="83" r="1.3" />
        <circle cx="127" cy="73" r="1.3" />
      </g>
      <Tower x={26} y={58} />
      <Tower x={134} y={58} />
    </>
  ),

  // マツダスタジアム：三塁側だけに架かる大きな片流れ屋根
  mazda: (
    <>
      <Bowl />
      <Field />
      <path
        fill="currentColor"
        fillOpacity="0.2"
        d="M16 48a64 22 0 0 1 64-22v12a44 14 0 0 0-44 14z"
      />
      <path d="M16 48a64 22 0 0 1 64-22" />
      <path d="M36 52a44 14 0 0 1 44-14" />
      <path d="M16 48l20 4M80 26v12" strokeWidth="1" />
      <Tower x={124} y={42} />
      <Tower x={112} y={66} />
    </>
  ),
}

/** 知らない球場のときの型 */
const FALLBACK: Record<StadiumShape, ReactNode> = {
  dome: <Dome />,
  roof: (
    <Dome>
      <path d="M52 20h56" strokeDasharray="3 4" strokeWidth="1" />
    </Dome>
  ),
  // 屋根なしの球場。バックネットと照明塔で球場らしさを出す
  open: (
    <>
      <Bowl />
      <Field />
      <path d="M66 72v-8h28v8" fill="currentColor" fillOpacity="0.12" />
      <path d="M66 72v-8h28v8" strokeWidth="1" />
      <path d="M73 70.5v-7M80 70v-6M87 70.5v-7" strokeWidth="0.8" opacity="0.5" />
      <Tower x={28} y={60} />
      <Tower x={132} y={60} />
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
      viewBox="0 0 160 100"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ART[id] ?? FALLBACK[shape]}
    </svg>
  )
}
