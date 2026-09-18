import type { SVGProps } from 'react'

/**
 * Marine Wallet のアイコンセット。
 * 仕様書 4.1 の禁止事項に従い、UIでは絵文字を一切使わず単色のラインアイコンで統一する。
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 22, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export function IconHome(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 11.2 12 4l9 7.2" />
      <path d="M5.6 10.2V20h12.8v-9.8" />
      <path d="M10 20v-4.6h4V20" />
    </Icon>
  )
}

export function IconSavings(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6.8c0-1.55 3.58-2.8 8-2.8s8 1.25 8 2.8-3.58 2.8-8 2.8-8-1.25-8-2.8Z" />
      <path d="M4 6.8v4.7c0 1.55 3.58 2.8 8 2.8s8-1.25 8-2.8V6.8" />
      <path d="M4 11.5v4.7c0 1.55 3.58 2.8 8 2.8s8-1.25 8-2.8v-4.7" />
    </Icon>
  )
}

export function IconSplit(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 3.6v16.8" />
      <path d="M8.6 8.4H6.4" />
      <path d="M17.6 15.6h-2.2" />
    </Icon>
  )
}

export function IconHistory(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 3.8v16.4h16" />
      <path d="M7.2 15.6 11 11.2l2.9 2.4L20 7" />
    </Icon>
  )
}

export function IconUser(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </Icon>
  )
}

export function IconPlus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  )
}

export function IconMinus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
    </Icon>
  )
}

export function IconCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </Icon>
  )
}

export function IconClose(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </Icon>
  )
}

export function IconChevronRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 5.5 15.5 12 9 18.5" />
    </Icon>
  )
}

export function IconChevronUp(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.5 15 12 8.5 18.5 15" />
    </Icon>
  )
}

export function IconChevronDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.5 9 12 15.5 18.5 9" />
    </Icon>
  )
}

export function IconCopy(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.4" />
      <path d="M15.5 5.5H6.9A2.4 2.4 0 0 0 4.5 7.9v8.6" />
    </Icon>
  )
}

export function IconExternal(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.5 4.5H19.5v6" />
      <path d="M19.5 4.5 11 13" />
      <path d="M18 14.5v3.6a2 2 0 0 1-2 2H5.9a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.6" />
    </Icon>
  )
}

export function IconEdit(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L5.5 16.5l-1 3Z" />
      <path d="M14.5 7.5 17 10" />
    </Icon>
  )
}

export function IconTrash(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 6.5h15" />
      <path d="M9.5 6.5V4.8h5v1.7" />
      <path d="M6.8 6.5 7.6 20h8.8l.8-13.5" />
      <path d="M10.4 10v6.2" />
      <path d="M13.6 10v6.2" />
    </Icon>
  )
}

export function IconRules(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 7.5h10" />
      <circle cx="17.5" cy="7.5" r="2" />
      <path d="M19.5 16.5h-10" />
      <circle cx="6.5" cy="16.5" r="2" />
    </Icon>
  )
}

export function IconCalendar(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2.4" />
      <path d="M4 10h16" />
      <path d="M8.5 3.5v4" />
      <path d="M15.5 3.5v4" />
    </Icon>
  )
}

export function IconLink(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7l-1.3 1.3" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.3-1.3" />
    </Icon>
  )
}

export function IconLogout(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14.5 5.5H7.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7" />
      <path d="M15 12h5.5" />
      <path d="m17.8 9.2 2.7 2.8-2.7 2.8" />
    </Icon>
  )
}

export function IconBank(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 9.5 12 4.5l8.5 5" />
      <path d="M5.5 9.5v8" />
      <path d="M10 9.5v8" />
      <path d="M14 9.5v8" />
      <path d="M18.5 9.5v8" />
      <path d="M3.5 19.8h17" />
    </Icon>
  )
}

export function IconSpark(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18l-1.8-5.4L4.5 10.8 10.2 9 12 3.5Z" />
    </Icon>
  )
}

export function IconWallet(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.8 8.2a2.4 2.4 0 0 1 2.4-2.4h11.6a2.4 2.4 0 0 1 2.4 2.4v8.6a2.4 2.4 0 0 1-2.4 2.4H6.2a2.4 2.4 0 0 1-2.4-2.4Z" />
      <path d="M3.8 10.6h5a2 2 0 0 1 0 4h-5" />
    </Icon>
  )
}

export function IconUsers(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9.2" cy="8.4" r="3.2" />
      <path d="M3.4 19.4a5.8 5.8 0 0 1 11.6 0" />
      <path d="M16 5.6a3.2 3.2 0 0 1 0 6" />
      <path d="M17.6 14.2a5.8 5.8 0 0 1 3 5.2" />
    </Icon>
  )
}

export function IconClock(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.2V12l3.2 2" />
    </Icon>
  )
}

export function IconBell(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.4 10.2a5.6 5.6 0 0 1 11.2 0c0 4 1.4 5.6 1.4 5.6H5c0 0 1.4-1.6 1.4-5.6Z" />
      <path d="M10.2 18.6a2 2 0 0 0 3.6 0" />
    </Icon>
  )
}

export function IconArrowLeft(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 12H5" />
      <path d="m10.6 6.4-5.6 5.6 5.6 5.6" />
    </Icon>
  )
}

export function IconTrendUp(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 17.2 10 11l3.4 3L20 7.4" />
      <path d="M15 7.4h5v5" />
    </Icon>
  )
}

export function IconTrendDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7.4 10 13.6l3.4-3L20 17.2" />
      <path d="M15 17.2h5v-5" />
    </Icon>
  )
}

export function IconTarget(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="4.4" />
      <circle cx="12" cy="12" r="1" />
    </Icon>
  )
}

/** 虫めがね。名前で探すときに使う */
export function IconSearch(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10.8" cy="10.8" r="6.4" />
      <path d="M15.4 15.4 20 20" />
    </Icon>
  )
}

/** 地図。ピンと折り目のある紙の地図 */
export function IconMap(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.6 6.6 9 4.4v13L3.6 19.6z" />
      <path d="M9 4.4l5.4 2.2v3" />
      <path d="M9 17.4l5.4 2.2 5-2V12" />
      <path d="M14.4 6.6v2.2" />
      <circle cx="17.6" cy="7.2" r="2.2" />
      <path d="M17.6 9.4v2" />
    </Icon>
  )
}

export function IconFlame(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.6s4.8 3.4 4.8 7.9a4.8 4.8 0 0 1-9.6 0c0-1.5.7-2.8 1.5-3.8.3 1.1 1 1.9 1.8 1.9 1.1 0 1.5-1 1.5-2.4 0-1.3-.4-2.4-.4-2.4Z" />
      <path d="M12 20.4a4.8 4.8 0 0 0 4.8-4.8" />
    </Icon>
  )
}

export function IconBaseball(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M6.1 6.1c2.4 2 3.6 4.4 3.6 5.9s-1.2 3.9-3.6 5.9" />
      <path d="M17.9 6.1c-2.4 2-3.6 4.4-3.6 5.9s1.2 3.9 3.6 5.9" />
    </Icon>
  )
}

export function IconTicket(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 8.4a1.6 1.6 0 0 1 1.6-1.6h12.8A1.6 1.6 0 0 1 20 8.4v2a2 2 0 0 0 0 3.2v2a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 15.6v-2a2 2 0 0 0 0-3.2Z" />
      <path d="M14 7.6v8.8" />
    </Icon>
  )
}

export function IconFood(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.4 3.8v6a2.4 2.4 0 0 0 4.8 0v-6" />
      <path d="M8.8 3.8v16.4" />
      <path d="M17.2 3.8c-1.5 1.2-2.2 3-2.2 5.2s.7 2.8 2.2 2.8v8.4" />
    </Icon>
  )
}

export function IconBeer(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.6 8h8.2v11.2a1.2 1.2 0 0 1-1.2 1.2H7.8a1.2 1.2 0 0 1-1.2-1.2Z" />
      <path d="M14.8 10.4h2.4a2.4 2.4 0 0 1 0 4.8h-2.4" />
      <path d="M6.6 8a2.6 2.6 0 0 1 2.6-2.6 2.4 2.4 0 0 1 4.4-.8 2.2 2.2 0 0 1 1.2 3.4" />
    </Icon>
  )
}

export function IconGoods(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.2 8.4h13.6l-1.1 11a1.4 1.4 0 0 1-1.4 1.2H7.7a1.4 1.4 0 0 1-1.4-1.2Z" />
      <path d="M9 10.4V7a3 3 0 0 1 6 0v3.4" />
    </Icon>
  )
}

export function IconTransport(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5.4" y="3.8" width="13.2" height="12.6" rx="2.4" />
      <path d="M5.4 11.4h13.2" />
      <path d="m7.4 16.4-2 3.8" />
      <path d="m16.6 16.4 2 3.8" />
      <path d="M9 14.2h.01" />
      <path d="M15 14.2h.01" />
    </Icon>
  )
}

export function IconDots(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="5.4" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="18.6" cy="12" r="1.2" />
    </Icon>
  )
}

export function IconAlert(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.8v4.8" />
      <path d="M12 16.2h.01" />
    </Icon>
  )
}

export function IconRefresh(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4.4V9h-4.6" />
    </Icon>
  )
}

export function IconCamera(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 8.8A1.8 1.8 0 0 1 4.8 7h2.1l1.3-2.1h7.6L17.1 7h2.1A1.8 1.8 0 0 1 21 8.8v8.4A1.8 1.8 0 0 1 19.2 19H4.8A1.8 1.8 0 0 1 3 17.2Z" />
      <circle cx="12" cy="13" r="3.4" />
    </Icon>
  )
}
