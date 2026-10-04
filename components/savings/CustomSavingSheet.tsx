'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Amount, Button, Field, Sheet, inputClassCompact } from '@/components/ui'
import { IconClose } from '@/components/icons'
import { createClient } from '@/lib/supabase/client'
import { today } from '@/lib/format'
import { tapFeedback } from '@/lib/haptics'
import { SCENES, SCENE_HINTS, entryLabel, isPlayerRecord } from '@/lib/saving-label'
import type { SavingCustomPreset, SavingEntryRow, SavingRecordName } from '@/types'

/**
 * カスタム登録（試合結果から自動計算できない分を積み立てる）。
 * saving_entries に kind='custom' / game_id=null で保存する。
 *
 * 5つの項目で持つ（0057）。自動で入るぶん（npb.jp）と同じ並びにしてあり、
 * 一覧に混ざっても書き方がずれない。
 *
 *   1 名場面     記録の種類。5つで固定（名場面 / シーズン / 生涯 / 名球会 / 球団）
 *   2 記録名     サヨナラ満塁ホームラン。何があったか
 *   3 背番号・選手名
 *   4 金額
 *   5 備考
 *
 * 1は増やさない。増やせるようにすると「サヨナラ打（HR）」のような
 * 具体の出来事が種類の側に並び、1と2の区別がすぐ崩れる。
 * 2は一覧に無い言葉を書いて保存すると、次からその一覧に並ぶ。
 *
 * 中身はチームの出来事そのものなので、一緒に貯めている人と共有する。
 * ここで書くのは自分の行だけだが、DB のトリガー（saving_entries_share_custom）が
 * 同じ内容を全員ぶんに広げる。編集も削除も同じように全員に届く。
 */

/**
 * 選ぶことも書くこともできる欄。
 *
 * datalist は端末によって出方が大きく違い、候補が出ないこともある。
 * 自分で出したほうが、どの端末でも同じように見える。
 */
function Combo({
  value,
  onChange,
  options,
  placeholder,
  label,
  canAdd = false,
}: {
  value: string
  onChange: (next: string) => void
  /** 候補。金額や補足を持つものは右に出す */
  options: { key: string; name: string; amount?: number; note?: string }[]
  placeholder: string
  label: string
  /** 一覧に無い言葉を書いたとき、候補に足すかどうか */
  canAdd?: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  const typed = value.trim()
  const shown = typed
    ? options.filter((o) => o.name.includes(typed) && o.name !== typed)
    : options
  // 書いたものが一覧に無いときだけ、登録する行を出す
  const isNew = canAdd && typed.length > 0 && !options.some((o) => o.name === typed)

  return (
    <div
      ref={wrap}
      className="relative"
      onBlur={(e) => {
        // 候補を押したときは閉じない。押す前に blur が走るため
        if (!wrap.current?.contains(e.relatedTarget as Node)) setOpen(false)
      }}
    >
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={value}
          aria-label={label}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          className={inputClassCompact}
        />
        <button
          type="button"
          aria-label={`${label}の候補`}
          aria-expanded={open}
          onClick={() => {
            tapFeedback()
            setOpen((on) => !on)
          }}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-[10px] text-fg-mute transition-colors hover:border-marine/50 hover:text-marine"
        >
          {open ? '▲' : '▼'}
        </button>
      </div>

      {open && (shown.length > 0 || isNew) ? (
        <div className="absolute inset-x-0 top-[42px] z-20 max-h-56 overflow-y-auto rounded-xl border border-marine/45 bg-ink-2 shadow-[0_14px_34px_rgba(0,0,0,0.6)]">
          {shown.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                tapFeedback()
                onChange(option.name)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between gap-3 border-b border-line-soft px-3 py-2.5 text-left text-[13px] text-fg-dim transition-colors last:border-b-0 hover:bg-white/[0.04] hover:text-fg"
            >
              {/* 補足は名前の下に置く。横に並べると狭い画面で名前が潰れる */}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{option.name}</span>
                {option.note ? (
                  <span className="block truncate text-[11px] text-fg-mute">{option.note}</span>
                ) : null}
              </span>
              {typeof option.amount === 'number' && option.amount > 0 ? (
                <span className="tnum shrink-0 text-[11px] text-fg-mute">
                  ¥{option.amount.toLocaleString()}
                </span>
              ) : null}
            </button>
          ))}

          {isNew ? (
            <div className="flex items-center gap-2 bg-marine/10 px-3 py-2.5 text-[13px] text-marine">
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-marine text-[11px] leading-none text-ink">
                +
              </span>
              <span className="truncate">「{typed}」を登録</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default function CustomSavingSheet({
  entry,
  presets,
  recordNames,
  userId,
  onClose,
}: {
  entry: SavingEntryRow | null
  /** 貯金ルールの画面で増やせる定型。名場面の候補になる */
  presets: SavingCustomPreset[]
  /** 記録名の候補 */
  recordNames: SavingRecordName[]
  userId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [date, setDate] = useState(entry?.entry_date ?? today())
  const [scene, setScene] = useState(entry?.scene ?? '')
  const [title, setTitle] = useState(entry?.title ?? '')
  const [number, setNumber] = useState(entry?.uniform_number ?? '')
  const [player, setPlayer] = useState(entry?.player_name ?? '')
  const [amount, setAmount] = useState(entry ? String(entry.amount) : '')
  const [note, setNote] = useState(entry?.other_note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * 名場面は5つで固定。金額は貯金ルールの画面がラベルごとに持っている。
   *
   * 自動で入るぶん（シーズン・生涯・名球会・球団）も選べるようにしてある。
   * npb.jp に出ない記録を自分で見つけたときに、同じ種類で残せる。
   */
  const sceneOptions = useMemo(
    () =>
      SCENES.map((name) => ({
        key: name,
        name,
        amount: presets.find((p) => p.label === name)?.amount ?? 0,
        note: SCENE_HINTS[name],
      })),
    [presets]
  )
  /** 記録名。選ぶと金額も入る（持っていれば） */
  const recordOptions = useMemo(
    () => recordNames.map((r) => ({ key: r.id, name: r.name, amount: r.amount })),
    [recordNames]
  )

  const parsedAmount = Math.max(0, Number.parseInt(amount || '0', 10) || 0)
  const who = { uniform_number: number, player_name: player }
  const preview = entryLabel(who, title)
  // 名前はあるのに背番号が無い状態。球団の記録として残ってしまう
  const nameWithoutNumber = player.trim().length > 0 && !isPlayerRecord(who)
  const canSubmit = scene.trim().length > 0 && parsedAmount > 0 && Boolean(date)

  /** 名場面を選んだら金額をその場で入れる（後から直せる） */
  const pickScene = (next: string) => {
    setScene(next)
    const found = sceneOptions.find((o) => o.name === next.trim())
    if (found && found.amount > 0 && !amount) setAmount(String(found.amount))
  }

  /** 記録名が金額を持っていれば、そちらを優先する。より細かいほうに合わせる */
  const pickRecord = (next: string) => {
    setTitle(next)
    const found = recordOptions.find((o) => o.name === next.trim())
    if (found && found.amount > 0) setAmount(String(found.amount))
  }

  const save = async () => {
    if (!canSubmit) return
    setSaving(true)
    setError(null)

    const supabase = createClient()
    const sceneName = scene.trim()
    const recordName = title.trim()

    // 一覧に無い記録名は、そのとき候補に足す。毎回打ち直さずに済む。
    // 失敗しても積立は止めない（候補が増えないだけで、記録は残る）。
    // 名場面はここでは増やさない。5つで固定している
    if (recordName && !recordOptions.some((o) => o.name === recordName)) {
      await supabase
        .from('saving_record_names')
        .insert({ name: recordName, amount: parsedAmount, sort_order: 100 })
    }

    const payload = {
      user_id: userId,
      game_id: null,
      kind: 'custom' as const,
      scene: sceneName,
      title: recordName,
      uniform_number: number.trim().replace(/^#/, ''),
      player_name: player.trim(),
      entry_date: date,
      amount: parsedAmount,
      breakdown: [{ key: 'custom', label: sceneName, amount: parsedAmount }],
      other_amount: 0,
      other_note: note.trim(),
    }

    const { error: failed } = entry
      ? await supabase.from('saving_entries').update(payload).eq('id', entry.id)
      : await supabase.from('saving_entries').insert(payload)

    setSaving(false)
    if (failed) {
      setError('保存に失敗しました')
      return
    }
    onClose()
    router.refresh()
  }

  return (
    <Sheet
      title={entry ? 'カスタム登録を編集' : 'カスタム登録'}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {error ? <p className="text-[13px] text-danger">{error}</p> : null}
          <Button variant="primary" full onClick={save} disabled={saving || !canSubmit}>
            {saving ? '保存中' : entry ? '更新する' : 'この内容で貯金する'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="w-40">
          <Field label="日付">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`${inputClassCompact} tnum`}
            />
          </Field>
        </div>

        <Field label="名場面" hint="記録の種類">
          <Combo
            label="名場面"
            value={scene}
            onChange={pickScene}
            options={sceneOptions}
            placeholder="選んでください"
          />
        </Field>

        <Field label="記録名" hint="選ぶ / 書く">
          <Combo
            label="記録名"
            value={title}
            onChange={pickRecord}
            options={recordOptions}
            placeholder="例: サヨナラ満塁ホームラン"
            canAdd
          />
        </Field>

        {/* 背番号があれば選手の記録、無ければ球団の記録として残す */}
        <Field label="背番号・選手名" hint="空なら球団の記録">
          <div className="flex gap-2">
            <div className="flex w-[108px] shrink-0 items-center gap-1 rounded-lg border border-line bg-ink-2/80 px-3 transition-colors focus-within:border-marine/70">
              <span className="text-[16px] text-fg-mute">#</span>
              <input
                type="text"
                inputMode="numeric"
                value={number}
                aria-label="背番号"
                placeholder="51"
                onChange={(e) => setNumber(e.target.value)}
                className="tnum w-full border-0 bg-transparent py-2 text-[16px] text-fg outline-none placeholder:text-fg-mute"
              />
            </div>
            <input
              type="text"
              value={player}
              aria-label="選手名"
              placeholder="山口"
              onChange={(e) => setPlayer(e.target.value)}
              className={inputClassCompact}
            />
          </div>
          {/* 名前だけ書くと、札は球団のままで見出しだけ名前になる。先に気づけるようにする */}
          {nameWithoutNumber ? (
            <p className="mt-1.5 text-[11px] leading-snug text-fg-mute">
              背番号を入れると個人の記録になります
            </p>
          ) : null}
        </Field>

        <Field label="金額" hint="名場面を選ぶと入ります">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className={`${inputClassCompact} tnum`}
          />
        </Field>

        <Field label="備考" hint="任意">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ZOZOマリン 9回裏"
            className={inputClassCompact}
          />
        </Field>

        {/* このまま残る形。自動で入るぶんと同じ並びになる */}
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center gap-2">
            <span className="eyebrow">このまま残る形</span>
            {scene.trim() ? (
              <span className="shrink-0 rounded-full border border-line px-2 text-[10px] leading-[17px] text-fg-dim">
                {scene.trim()}
              </span>
            ) : null}
            <span
              className={`shrink-0 rounded-full border px-2 text-[10px] leading-[17px] ${
                isPlayerRecord(who)
                  ? 'border-marine/45 text-marine'
                  : 'border-line text-fg-mute'
              }`}
            >
              {isPlayerRecord(who) ? '個人' : '球団'}
            </span>
          </div>
          <p className="mt-2 text-[14px] leading-snug">{preview}</p>
          <div className="mt-3 border-t border-line pt-3 text-center">
            <Amount value={parsedAmount} size="lg" tone="marine" />
            <p className="mt-2 text-[11px] leading-relaxed text-fg-mute">
              カスタム登録にフェーズ倍率は適用されません。
              <br />
              内容と金額は一緒に貯めているメンバー全員に反映されます。
            </p>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
