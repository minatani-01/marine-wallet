'use client'

import { useState } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { IconCheck, IconClose, IconMinus, IconPlus } from '@/components/icons'
import { yen } from '@/lib/format'
import { tapFeedback } from '@/lib/haptics'

// ---------------------------------------------------------------- Card ----
export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <div className={`glass rounded-2xl ${padded ? 'p-4' : ''} ${className}`}>{children}</div>
  )
}

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-end justify-between gap-3">
      <span className="eyebrow">{children}</span>
      {action}
    </div>
  )
}

// ------------------------------------------------------------- Amounts ----
export function Amount({
  value,
  size = 'md',
  tone = 'default',
}: {
  value: number
  size?: 'sm' | 'md' | 'lg' | 'xl'
  tone?: 'default' | 'marine' | 'dim' | 'danger'
}) {
  const sizes = {
    sm: 'text-base',
    md: 'text-2xl',
    lg: 'text-[32px] leading-none',
    xl: 'text-[42px] leading-none',
  }
  const tones = {
    default: 'text-fg',
    marine: 'text-marine',
    dim: 'text-fg-dim',
    danger: 'text-danger',
  }
  return (
    <span className={`tnum font-semibold ${sizes[size]} ${tones[tone]}`}>{yen(value)}</span>
  )
}

export function StatTile({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'marine' | 'dim' | 'danger'
}) {
  return (
    <Card className="min-w-0">
      <div className="eyebrow truncate">{label}</div>
      <div className="mt-2">
        {typeof value === 'number' ? <Amount value={value} tone={tone} /> : value}
      </div>
      {sub ? <div className="mt-1 text-xs text-fg-mute">{sub}</div> : null}
    </Card>
  )
}

// ------------------------------------------------------------- Buttons ----
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'outline' | 'danger'
  full?: boolean
}

export function Button({
  variant = 'outline',
  full = false,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl px-4 min-h-[46px] text-sm font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none'
  const variants = {
    primary:
      'bg-marine text-ink hover:bg-teal font-semibold shadow-[0_0_40px_-18px_rgba(34,211,238,0.9)]',
    outline: 'border border-line text-fg hover:border-marine/60 hover:text-marine bg-white/[0.02]',
    ghost: 'text-fg-dim hover:text-fg',
    danger: 'border border-danger/40 text-danger hover:bg-danger/10',
  }
  return (
    <button
      className={`${base} ${variants[variant]} ${full ? 'w-full' : ''} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function IconButton({
  label,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-fg-mute transition-colors hover:border-marine/50 hover:text-marine ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- Chip ----
export function Chip({
  selected,
  onClick,
  children,
  sub,
  className = '',
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
  sub?: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={() => {
        tapFeedback()
        onClick()
      }}
      aria-pressed={selected}
      className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm transition-colors ${
        selected
          ? 'border-marine/70 bg-marine/10 text-marine font-medium'
          : 'border-line bg-white/[0.02] text-fg-dim hover:border-line hover:text-fg'
      } ${className}`}
    >
      <span className="block leading-tight">{children}</span>
      {sub ? <span className="mt-0.5 block text-[10px] leading-tight opacity-70">{sub}</span> : null}
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (id: T) => void
}) {
  return (
    <div className="flex rounded-xl border border-line bg-white/[0.02] p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => {
            tapFeedback()
            onChange(o.id)
          }}
          aria-pressed={value === o.id}
          className={`min-h-[38px] flex-1 rounded-lg px-2 text-[13px] transition-colors ${
            value === o.id ? 'bg-marine/15 text-marine font-medium' : 'text-fg-mute hover:text-fg'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// --------------------------------------------------------------- Field ----
export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[13px] font-medium text-fg-dim">{label}</span>
        {hint ? <span className="text-[11px] text-fg-mute">{hint}</span> : null}
      </div>
      {children}
    </div>
  )
}

export const inputClass =
  'w-full rounded-xl border border-line bg-ink-2/80 px-3.5 py-2.5 text-fg outline-none transition-colors placeholder:text-fg-mute focus:border-marine/70'

/** inputClass の高さを詰めたもの。入力欄が続く画面で使う */
export const inputClassCompact =
  'w-full rounded-lg border border-line bg-ink-2/80 px-3 py-2 text-[14px] text-fg outline-none transition-colors placeholder:text-fg-mute focus:border-marine/70'

/**
 * ラベルと操作を1行に収める行。
 *
 * 縦に積むと1項目で3行使ってしまう画面向け。
 * 44px を下回らないようにして、指で押せる大きさは保つ。
 */
export function InlineRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-line bg-white/[0.02] px-3 py-1.5">
      <div className="min-w-0">
        <div className="truncate text-[13px] text-fg-dim">{label}</div>
        {hint ? <div className="truncate text-[10px] text-fg-mute">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** InlineRow の中に置く、増減ボタン付きの数値 */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string
  value: number
  onChange: (next: number) => void
  min?: number
}) {
  const step = (delta: number) => {
    tapFeedback()
    onChange(Math.max(min, value + delta))
  }
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={`${label}を減らす`}
        onClick={() => step(-1)}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-fg-dim transition-colors hover:border-marine/50 hover:text-marine"
      >
        <IconMinus size={14} />
      </button>
      <span className="tnum w-7 text-center text-[15px] font-semibold">{value}</span>
      <button
        type="button"
        aria-label={`${label}を増やす`}
        onClick={() => step(1)}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-fg-dim transition-colors hover:border-marine/50 hover:text-marine"
      >
        <IconPlus size={14} />
      </button>
    </div>
  )
}

/** InlineRow の中に置く、入り切りのスイッチ */
export function Switch({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => {
        tapFeedback()
        onChange(!checked)
      }}
      className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-marine' : 'bg-line'}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-ink transition-all ${
          checked ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

// -------------------------------------------------------------- Status ----
export function StatusPill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'marine' | 'warn' | 'done'
}) {
  const tones = {
    neutral: 'border-line text-fg-mute',
    marine: 'border-marine/50 text-marine',
    warn: 'border-warn/50 text-warn',
    done: 'border-teal/50 text-teal',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] tracking-[0.14em] uppercase ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

// --------------------------------------------------------------- Sheet ----
export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center">
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl border border-line bg-ink-2 pb-[env(safe-area-inset-bottom)] sm:rounded-3xl sm:pb-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold tracking-wide">{title}</h2>
          <IconButton label="閉じる" onClick={onClose}>
            <IconClose size={18} />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer ? <div className="border-t border-line px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Misc ----
export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <p className="text-sm text-fg-dim">{title}</p>
      {description ? <p className="mt-1.5 text-xs text-fg-mute">{description}</p> : null}
    </div>
  )
}

export function Row({
  label,
  value,
  strong = false,
}: {
  label: ReactNode
  value: ReactNode
  strong?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className={`text-[13px] ${strong ? 'text-fg' : 'text-fg-mute'}`}>{label}</span>
      <span className={`tnum text-sm ${strong ? 'font-semibold text-fg' : 'text-fg-dim'}`}>
        {value}
      </span>
    </div>
  )
}

// ------------------------------------------------------------ Pill tabs ----
export function PillTabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (id: T) => void
}) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => {
            tapFeedback()
            onChange(o.id)
          }}
          aria-pressed={value === o.id}
          className={`min-h-[38px] shrink-0 rounded-full border px-4 text-[13px] transition-colors ${
            value === o.id
              ? 'border-marine/70 bg-marine/12 text-marine font-medium shadow-[0_0_26px_-14px_rgba(34,211,238,0.9)]'
              : 'border-line text-fg-mute hover:text-fg-dim'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ----------------------------------------------------------- Progress ----
export function ProgressBar({
  value,
  max,
  label,
  caption,
}: {
  value: number
  max: number
  label?: ReactNode
  caption?: ReactNode
}) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div>
      {label || caption ? (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="text-[13px] text-fg-dim">{label}</span>
          <span className="tnum text-[13px] text-fg">{caption}</span>
        </div>
      ) : null}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-marine shadow-[0_0_18px_-4px_rgba(34,211,238,0.9)] transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="tnum mt-1 text-right text-[11px] text-fg-mute">{percent}%</div>
    </div>
  )
}

// ------------------------------------------------------------- Avatar ----
/**
 * メンバーのアイコン。
 * src（署名付きURL）があれば写真、無ければ名前の頭文字を出す。
 * 署名付きURLは有効期限があるため、期限切れや読み込み失敗は onError で
 * 頭文字表示へ落とす。ここが崩れても情報は失われない。
 *
 * next/image を使わないのは、URL が毎回変わる署名付きで最適化キャッシュが効かず、
 * 40px の画像に最適化の往復を挟む意味が無いため。
 */
export function Avatar({
  name,
  src = null,
  selected = false,
  size = 40,
}: {
  name: string
  src?: string | null
  selected?: boolean
  size?: number
}) {
  const [failed, setFailed] = useState(false)
  const initial = name.trim().slice(0, 1) || '?'
  const showPhoto = Boolean(src) && !failed

  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border font-semibold ${
        selected
          ? 'border-marine/70 bg-marine/15 text-marine'
          : 'border-line bg-white/[0.03] text-fg-dim'
      }`}
    >
      {showPhoto ? (
        <img
          src={src!}
          alt=""
          width={size}
          height={size}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        initial
      )}
    </span>
  )
}

// ----------------------------------------------------------- Checkbox ----
export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        tapFeedback()
        onChange(!checked)
      }}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors disabled:opacity-40 ${
        checked
          ? 'border-marine/60 bg-marine/10 text-marine'
          : 'border-line text-fg-mute hover:border-marine/40'
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-flex h-4 w-4 items-center justify-center rounded border ${
          checked ? 'border-marine bg-marine text-ink' : 'border-line'
        }`}
      >
        {checked ? <IconCheck size={12} /> : null}
      </span>
      {label}
    </button>
  )
}

// ------------------------------------------------------------- Toggle ----
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
}) {
  return (
    <label
      className={`flex items-start justify-between gap-4 py-2.5 ${
        disabled ? 'opacity-40' : 'cursor-pointer'
      }`}
    >
      <span className="min-w-0">
        <span className="block text-[13px]">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] text-fg-mute">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => {
          tapFeedback()
          onChange(!checked)
        }}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors ${
          checked ? 'border-marine/70 bg-marine/30' : 'border-line bg-white/[0.04]'
        } disabled:pointer-events-none`}
      >
        <span
          className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-all ${
            checked ? 'left-[24px] bg-marine' : 'left-[3px] bg-fg-mute'
          }`}
        />
      </button>
    </label>
  )
}

// ---------------------------------------------------------- Icon frame ----
export function IconFrame({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'marine' }) {
  return (
    <span
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
        tone === 'marine' ? 'border-marine/50 bg-marine/10 text-marine' : 'border-line bg-white/[0.03] text-fg-dim'
      }`}
    >
      {children}
    </span>
  )
}
