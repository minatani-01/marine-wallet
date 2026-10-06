'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, SectionLabel, inputClassCompact } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { SCENES, SCENE_HINTS, type Scene } from '@/lib/saving-label'
import { IconPlus, IconTrash } from '@/components/icons'
import { DEFAULT_SAVING_RULES } from '@/lib/savings'
import type { SavingCustomPreset, SavingRecordName, SavingRules } from '@/types'

type AmountKey = Exclude<
  keyof SavingRules,
  | 'user_id'
  | 'multiplier_regular'
  | 'multiplier_interleague'
  | 'multiplier_cs'
  | 'multiplier_nippon_series'
>

type MultiplierKey =
  | 'multiplier_regular'
  | 'multiplier_interleague'
  | 'multiplier_cs'
  | 'multiplier_nippon_series'

const AMOUNT_SECTIONS: { title: string; note?: string; items: { key: AmountKey; label: string }[] }[] = [
  {
    title: '試合結果',
    items: [
      { key: 'win_amount', label: '勝利' },
      { key: 'draw_amount', label: '引き分け' },
      { key: 'lose_amount', label: '敗北' },
    ],
  },
  {
    // マルチ安打と打点は NPB 公式が1試合ごとの個人成績を公開していないため、
    // 自動登録の対象から外した。定型にも入れていないので、
    // 積み立てるならカスタム登録で内容と金額を直接入力する。
    title: '打撃',
    note: '満塁ホームランはホームラン本数に含めず別に数えます',
    items: [
      { key: 'home_run_amount', label: 'ホームラン（1本あたり）' },
      { key: 'grand_slam_amount', label: '満塁ホームラン（1本あたり）' },
    ],
  },
  {
    title: '投手',
    note: '先発ハイライトは最上位のみ加算、セーブは独立して加算されます',
    items: [
      { key: 'shutout_amount', label: '完封' },
      { key: 'complete_game_amount', label: '完投' },
      { key: 'hold_amount', label: 'ホールド' },
      { key: 'save_amount', label: 'セーブ' },
    ],
  },
]

const MULTIPLIERS: { key: MultiplierKey; label: string }[] = [
  { key: 'multiplier_regular', label: 'レギュラー' },
  { key: 'multiplier_interleague', label: '交流戦' },
  { key: 'multiplier_cs', label: 'CS' },
  { key: 'multiplier_nippon_series', label: '日本シリーズ' },
]

export default function RulesClient({
  userId,
  initialRules,
  initialPresets,
  initialRecordNames,
  canEdit,
}: {
  userId: string
  initialRules: SavingRules
  /** カスタム登録の定型。名場面の候補になる */
  initialPresets: SavingCustomPreset[]
  /** 記録名の候補（0057） */
  initialRecordNames: SavingRecordName[]
  /** 共通ルールを変更できるか。できない人には読み取り専用で見せる */
  canEdit: boolean
}) {
  const router = useRouter()
  const [rules, setRules] = useState<SavingRules>(initialRules)
  const [presets, setPresets] = useState<SavingCustomPreset[]>(initialPresets)
  const [recordNames, setRecordNames] = useState<SavingRecordName[]>(initialRecordNames)
  const [newRecordName, setNewRecordName] = useState('')
  const [newRecordAmount, setNewRecordAmount] = useState('')
  const [recordBusy, setRecordBusy] = useState(false)
  const [recordError, setRecordError] = useState<string | null>(null)
  const [presetError, setPresetError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * 名場面は5つで固定（lib/saving-label.ts の SCENES）。
   * saving_custom_presets はその金額を持つだけの表になっている。
   *
   * 金額をここで変えられるようにしておくと、記録の重みを見直したくなったとき、
   * コードに手を入れずに済む。SCENES の順で並べる。
   */
  const scenePresets = SCENES.map((name) => presets.find((p) => p.label === name)).filter(
    (p): p is SavingCustomPreset => Boolean(p)
  )

  /**
   * 記録名。何があったかの名前で、金額もここに付く。
   * 登録の画面で一覧に無い言葉を書いたときにも、同じ表へ足される。
   */
  const addRecordName = async () => {
    const name = newRecordName.trim()
    if (!name || recordNames.some((r) => r.name === name)) return
    setRecordBusy(true)
    setRecordError(null)

    const supabase = createClient()
    const amount = Math.max(0, Number.parseInt(newRecordAmount || '0', 10) || 0)
    const { data, error: failed } = await supabase
      .from('saving_record_names')
      .insert({ name, amount, sort_order: 100, created_by: userId })
      .select('id, name, amount, sort_order')
      .single()

    setRecordBusy(false)
    if (failed || !data) {
      setRecordError('追加できませんでした')
      return
    }
    setRecordNames([...recordNames, data as SavingRecordName])
    setNewRecordName('')
    setNewRecordAmount('')
  }

  /** 記録名の金額。入力のたびに書き戻す（定型の金額と同じ扱い） */
  const updateRecordAmount = async (id: string, raw: string) => {
    const amount = Math.max(0, Number.parseInt(raw, 10) || 0)
    setRecordNames((prev) => prev.map((r) => (r.id === id ? { ...r, amount } : r)))

    const supabase = createClient()
    const { error: failed } = await supabase
      .from('saving_record_names')
      .update({ amount })
      .eq('id', id)
    if (failed) setRecordError('金額を保存できませんでした')
    else setRecordError(null)
  }

  /** 候補から外すだけ。既に積み立てた記録の名前は変わらない */
  const removeRecordName = async (id: string) => {
    setRecordBusy(true)
    setRecordError(null)

    const supabase = createClient()
    const { error: failed } = await supabase.from('saving_record_names').delete().eq('id', id)

    setRecordBusy(false)
    if (failed) {
      setRecordError('削除できませんでした')
      return
    }
    setRecordNames(recordNames.filter((r) => r.id !== id))
  }

  /**
   * 名場面の金額。入力のたびに書き戻す。
   *
   * ルールの「保存する」とは別にその場で反映する。まとめて保存にすると、
   * 直したのに保存を押し忘れる事故が起きる。
   */
  const updatePresetAmount = async (id: string, raw: string) => {
    const amount = Math.max(0, Number.parseInt(raw, 10) || 0)
    setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, amount } : p)))

    const supabase = createClient()
    const { error: failed } = await supabase
      .from('saving_custom_presets')
      .update({ amount, updated_by: userId })
      .eq('id', id)
    if (failed) setPresetError('名場面の金額を保存できませんでした')
    else setPresetError(null)
  }

  const setAmount = (key: AmountKey, raw: string) => {
    const parsed = Number.parseInt(raw, 10)
    setRules((prev) => ({ ...prev, [key]: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0 }))
    setSaved(false)
  }

  const setMultiplier = (key: MultiplierKey, raw: string) => {
    const parsed = Number.parseFloat(raw)
    setRules((prev) => ({
      ...prev,
      [key]: Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 10) : 0,
    }))
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('saving_rule_settings')
      .update({ ...rules, updated_by: userId })
      .eq('id', true)
    setSaving(false)
    if (error) {
      setError('保存に失敗しました')
      return
    }
    setSaved(true)
    router.refresh()
  }

  const numberInput =
    'tnum w-28 rounded-lg border border-line bg-ink-2/80 px-3 py-2 text-right text-fg outline-none transition-colors focus:border-marine/70 disabled:opacity-60'

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[13px] leading-relaxed text-fg-mute">
          試合ごとの入力を減らし、ここで決めたルールから積立予定額を自動計算します。
          ルールは全アカウント共通です。過去に記録済みの試合の金額は、
          ルールを変更しても書き換わりません。
        </p>
        {canEdit ? null : (
          <p className="mt-2 text-[13px] leading-relaxed text-warn">
            変更する権限がありません。表示のみです。
            変更できるようにするには、マスターのメンバー画面で、あなたとの接続の
            「共有設定」から「貯金ルール」をONにしてもらってください。
          </p>
        )}
      </div>

      {AMOUNT_SECTIONS.map((section) => (
        <div key={section.title}>
          <SectionLabel>{section.title}</SectionLabel>
          <Card>
            {section.note ? <p className="mb-3 text-[11px] text-fg-mute">{section.note}</p> : null}
            <div className="divide-hairline">
              {section.items.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-4 py-2.5">
                  <label htmlFor={item.key} className="text-[13px] text-fg-dim">
                    {item.label}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-fg-mute">¥</span>
                    <input
                      id={item.key}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={100}
                      value={rules[item.key]}
                      onChange={(e) => setAmount(item.key, e.target.value)}
                      disabled={!canEdit}
                className={numberInput}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ))}

      <div>
        <SectionLabel>フェーズ倍率</SectionLabel>
        <Card>
          <div className="divide-hairline">
            {MULTIPLIERS.map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-4 py-2.5">
                <label htmlFor={item.key} className="text-[13px] text-fg-dim">
                  {item.label}
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-fg-mute">×</span>
                  <input
                    id={item.key}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={10}
                    step={0.1}
                    value={rules[item.key]}
                    onChange={(e) => setMultiplier(item.key, e.target.value)}
                    disabled={!canEdit}
                className={numberInput}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {scenePresets.length > 0 ? (
        <div>
          <SectionLabel>名場面の金額</SectionLabel>
          <Card>
            <p className="mb-3 text-[11px] leading-relaxed text-fg-mute">
              カスタム登録の「名場面」はこの5つで、増やしません。選んだときに入る金額を、
              ここで決めます。下の4つは npb.jp から取れるので、自動登録が毎朝入れます。
            </p>

            <div className="divide-hairline">
              {scenePresets.map((preset) => (
                <div key={preset.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-fg-dim">{preset.label}</p>
                    <p className="truncate text-[11px] text-fg-mute">
                      {SCENE_HINTS[preset.label as Scene]}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="text-fg-mute">¥</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={100}
                      value={preset.amount}
                      onChange={(e) => updatePresetAmount(preset.id, e.target.value)}
                      disabled={!canEdit}
                      aria-label={`${preset.label}の金額`}
                      className={numberInput}
                    />
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-fg-mute">
              何があったかは、名場面ではなく「記録名」に書きます。
              金額を変えても、すでに積み立てた分は変わりません。
            </p>
          </Card>
        </div>
      ) : null}

      {/* 記録名の候補（0057）。何があったかの名前。金額もここに付く */}
      <div>
        <SectionLabel>記録名の候補</SectionLabel>
        <Card>
          <p className="mb-3 text-[11px] leading-relaxed text-fg-mute">
            カスタム登録の「記録名」に出る一覧です。選ぶと金額もいっしょに入ります。
            登録のときに一覧に無い言葉を書くと、そのとき自動で足されます。
            消しても、すでに積み立てた記録の名前は変わりません。
          </p>

          {recordNames.length === 0 ? (
            <p className="py-2 text-[13px] text-fg-mute">まだありません。</p>
          ) : (
            <div className="divide-hairline">
              {recordNames.map((record) => (
                <div key={record.id} className="flex items-center justify-between gap-2 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-fg-dim">
                    {record.name}
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="text-fg-mute">¥</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={100}
                      value={record.amount}
                      onChange={(e) => updateRecordAmount(record.id, e.target.value)}
                      disabled={!canEdit}
                      aria-label={`${record.name}の金額`}
                      className={numberInput}
                    />
                    {canEdit ? (
                      <button
                        type="button"
                        aria-label={`${record.name}を候補から外す`}
                        disabled={recordBusy}
                        onClick={() => removeRecordName(record.id)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-fg-mute transition-colors hover:border-danger/50 hover:text-danger disabled:opacity-40"
                      >
                        <IconTrash size={15} />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          {canEdit ? (
            <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newRecordName}
                  onChange={(e) => setNewRecordName(e.target.value)}
                  placeholder="例: 逆転サヨナラHR"
                  aria-label="記録名"
                  className={inputClassCompact}
                />
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={100}
                  value={newRecordAmount}
                  onChange={(e) => setNewRecordAmount(e.target.value)}
                  placeholder="金額"
                  aria-label="記録名の金額"
                  className={`${numberInput} shrink-0`}
                />
                <button
                  type="button"
                  aria-label="記録名を追加"
                  onClick={addRecordName}
                  disabled={recordBusy || !newRecordName.trim()}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-fg-dim transition-colors hover:border-marine/50 hover:text-marine disabled:opacity-40"
                >
                  <IconPlus size={16} />
                </button>
              </div>
              {recordError ? <p className="text-[13px] text-danger">{recordError}</p> : null}
              <p className="text-[11px] text-fg-mute">
                追加・変更・削除は、この場ですぐ反映されます。金額は 0 のままでも構いません。
              </p>
            </div>
          ) : null}
        </Card>
      </div>

      {canEdit ? (
        <div className="flex flex-col gap-2">
          {error ? <p className="text-[13px] text-danger">{error}</p> : null}
          {saved ? <p className="text-[13px] text-teal">保存しました</p> : null}
          <Button variant="primary" full onClick={save} disabled={saving}>
            {saving ? '保存中' : 'ルールを保存する'}
          </Button>
          <Button
            variant="ghost"
            full
            onClick={() => {
              setRules({ ...DEFAULT_SAVING_RULES })
              setSaved(false)
            }}
          >
            初期値に戻す
          </Button>
        </div>
      ) : null}
    </div>
  )
}
