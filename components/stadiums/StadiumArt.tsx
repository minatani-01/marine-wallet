import type { StadiumShape } from '@/lib/stadiums'

/**
 * 券面の球場の絵。
 *
 * 17球場ぶんの外観を1つずつ描くと、球場が増えるたびに絵が要る。
 * ドーム／開閉屋根／屋根なしの3型で描き分け、球場らしさは差し色と
 * 名前で出す。線だけなので、訪問前はそのまま薄く沈められる。
 */
export default function StadiumArt({
  shape,
  className = '',
}: {
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
      {shape === 'dome' ? (
        <>
          <path d="M16 44V34a44 22 0 0 1 88 0v10" />
          <path d="M60 12v-4" />
          <path d="M33 44v-7h13v7M53.5 44v-7h13v7M74 44v-7h13v7" />
        </>
      ) : null}

      {shape === 'roof' ? (
        <>
          <path d="M16 44V34a44 22 0 0 1 28-19.5" />
          <path d="M104 44V34a44 22 0 0 0-28-19.5" />
          <path d="M46 13.5h28" strokeDasharray="3 4" />
          <path d="M33 44v-7h13v7M53.5 44v-7h13v7M74 44v-7h13v7" />
        </>
      ) : null}

      {shape === 'open' ? (
        <>
          <path d="M14 44l12-18h68l12 18" />
          <path d="M26 35h68" />
          <path d="M24 26V12M96 26V12" />
          <path d="M18 12h12M90 12h12" />
        </>
      ) : null}

      <path d="M6 44h108" />
    </svg>
  )
}
