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

/** スタンドの外壁。すり鉢の厚みを出す */
function Wall() {
  return (
    <>
      <path d="M16 52v11a64 22 0 0 0 128 0V52" fill="currentColor" fillOpacity="0.12" />
      <path d="M16 63a64 22 0 0 0 128 0" />
      <path d="M16 52v11M144 52v11" />
      <g strokeWidth="0.9" opacity="0.55">
        <path d="M56 72.4v11M80 74v11M104 72.4v11M32 66.5v11M128 66.5v11" />
      </g>
    </>
  )
}

/** 座席帯と通路 */
function Stands() {
  return (
    <>
      <path
        fillRule="evenodd"
        fill="currentColor"
        fillOpacity="0.15"
        d="M144 52a64 22 0 1 1-128 0 64 22 0 1 1 128 0ZM124 54a44 13 0 1 0-88 0 44 13 0 1 0 88 0Z"
      />
      <ellipse cx="80" cy="52" rx="64" ry="22" />
      <ellipse cx="80" cy="54" rx="44" ry="13" />
      <g strokeWidth="0.9" opacity="0.6">
        <path d="M36 54 16 52M124 54l20-2M80 67v7M80 41V30" />
        <path d="M111 63l14 5M49 63l-14 5M111 45l14-9M49 45l-14-9" />
      </g>
    </>
  )
}

/** グラウンド。内野の土とファウルラインまで入れる */
function Field() {
  return (
    <>
      <ellipse cx="80" cy="54" rx="44" ry="13" fill="currentColor" fillOpacity="0.1" />
      <path
        d="M62 65q18-15 36 0z"
        fill="currentColor"
        fillOpacity="0.22"
        stroke="none"
      />
      <g strokeWidth="0.9" opacity="0.85">
        <path d="M80 65 40 54M80 65l40-11" />
        <path d="M80 65l15-5-15-5-15 5z" />
      </g>
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
      <Wall />
      {/* 手前の斜面 */}
      <path d="M14 48 100 66 121 30 35 12z" fill="currentColor" fillOpacity="0.2" />
      {/* 奥の斜面 */}
      <path d="M35 12 121 30 146 40 60 22z" fill="currentColor" fillOpacity="0.1" />
      {/* 妻面（ガラス） */}
      <path d="M14 48 60 22 35 12z" fill="currentColor" fillOpacity="0.14" />
      <path d="M100 66 146 40 121 30z" fill="currentColor" fillOpacity="0.14" />
      <path d="M14 48 100 66 146 40 60 22z" />
      <path d="M35 12 121 30" />
      <path d="M14 48 35 12M100 66 121 30M60 22 35 12M146 40 121 30" />
      <g strokeWidth="0.8" opacity="0.55">
        <path d="M21 36 107 54M28 24l86 18M57 57 78 21" />
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
