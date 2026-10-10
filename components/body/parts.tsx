'use client'

import type { ReactNode } from 'react'

import { Card, inputClass } from '@/components/ui'
import { weightTrend } from '@/lib/reform'

/**
 * からだの画面で使い回す部品（0064）。
 *
 * 記録を付ける画面が6つあり、どれも「選ぶ・数を入れる・メモ・保存」の
 * 繰り返しになる。同じ見た目を6回書くと、直すときに1か所だけ漏れる。
 */

/** 小さい見出し付きの枠。入力を2列に並べる中で使う */
export function Labeled({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex min-w-0 items-baseline gap-1.5">
        <span className="truncate text-[11px] text-fg-mute">{label}</span>
        {hint ? <span className="shrink-0 text-[10px] text-fg-mute/70">{hint}</span> : null}
      </div>
      {children}
    </div>
  )
}

/** 数を入れる欄。iOS が勝手に拡大しないよう、字は 16px のまま使う */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  label,
}: {
  value: string
  onChange: (next: string) => void
  min?: number
  max?: number
  step?: number | string
  placeholder?: string
  label: string
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`tnum ${inputClass} !px-3 !py-2`}
    />
  )
}

/** 選ぶ欄。min-w-0 を付けないと、長い選択肢で隣の列へはみ出す */
export function Select({
  value,
  onChange,
  label,
  children,
}: {
  value: string
  onChange: (next: string) => void
  label: string
  children: ReactNode
}) {
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputClass} min-w-0 !px-3 !py-2`}
    >
      {children}
    </select>
  )
}

/** メモ。どの記録にも付けられるようにしてある */
export function NoteInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
}) {
  return (
    <textarea
      value={value}
      aria-label="メモ"
      rows={2}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputClass} resize-none !py-2`}
    />
  )
}

/**
 * 気をつけることの札。
 *
 * 機器や施設の案内のほうが正しい、という但し書きを出す。アプリの中の数字を
 * 頼りに無理をしてしまうのが、この種の記録でいちばん困ること。
 */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-line bg-white/[0.02] px-3.5 py-2.5 text-[11px] leading-relaxed text-fg-mute">
      {children}
    </p>
  )
}

/** 履歴の1行。日付・中身・右端の数 */
export function LogRow({
  date,
  children,
  right,
}: {
  date: string
  children: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="flex items-start gap-3 border-b border-line-soft py-2.5 last:border-b-0">
      <span className="tnum w-11 shrink-0 pt-0.5 text-[11px] text-fg-mute">
        {date.slice(5).replace('-', '/')}
      </span>
      <div className="min-w-0 flex-1 text-[12px] leading-relaxed text-fg-dim">{children}</div>
      {right ? <span className="tnum shrink-0 text-[11px] text-fg-mute">{right}</span> : null}
    </div>
  )
}

/** 履歴のまとまり。まだ無いときは、そう書く */
export function LogList({
  title,
  empty = 'まだ記録がありません',
  children,
  count,
}: {
  title: string
  empty?: string
  children: ReactNode
  count: number
}) {
  return (
    <Card className="!p-3.5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold text-fg">{title}</span>
        <span className="tnum text-[10px] text-fg-mute">{count > 0 ? `${count}件` : ''}</span>
      </div>
      {count === 0 ? <p className="py-3 text-[12px] text-fg-mute">{empty}</p> : children}
    </Card>
  )
}

/**
 * 体重の推移。
 *
 * 目盛りは付けない。何kgかは数字で出してあるので、ここで見たいのは
 * 上がっているか下がっているかだけである。
 */
export function WeightSpark({ rows }: { rows: { date: string; weight: number }[] }) {
  const trend = weightTrend(rows)
  if (trend.length === 0) {
    return <p className="py-6 text-center text-[12px] text-fg-mute">体重を入れると推移が出ます</p>
  }

  const values = trend.map((r) => r.weight)
  const min = Math.min(...values)
  const max = Math.max(...values)
  // 全部同じ体重のときに 0 で割らない
  const range = Math.max(0.1, max - min)
  const diff = values[values.length - 1] - values[0]

  return (
    <div>
      <div className="flex h-24 items-end gap-1">
        {trend.map((row) => (
          <span
            key={row.date}
            title={`${row.date} ${row.weight}kg`}
            className="min-w-[6px] flex-1 rounded-t bg-gradient-to-b from-marine/80 to-marine/20"
            style={{ height: `${18 + ((row.weight - min) / range) * 76}%` }}
          />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-fg-mute">
        直近
        <span className="tnum text-fg-dim">{trend.length}</span>件：
        <span className={`tnum ${diff < 0 ? 'text-marine' : diff > 0 ? 'text-warn' : 'text-fg-dim'}`}>
          {diff >= 0 ? '+' : ''}
          {diff.toFixed(1)}kg
        </span>
      </p>
    </div>
  )
}

/** 数字を1つ出す小さな枠。体重・BMI など */
export function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="min-w-0 !p-3">
      <span className="block truncate text-[10px] text-fg-mute">{label}</span>
      <span className="tnum mt-1 block truncate text-[18px] font-semibold text-fg">{value}</span>
      {sub ? <span className="mt-0.5 block truncate text-[10px] text-fg-mute">{sub}</span> : null}
    </Card>
  )
}
