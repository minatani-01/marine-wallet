'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Amount,
  Button,
  Field,
  InlineRow,
  Row,
  Segmented,
  Sheet,
  Stepper,
  Switch,
  inputClassCompact,
} from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { calcSaving } from '@/lib/savings'
import { today } from '@/lib/format'
import { withTapFeedback } from '@/lib/haptics'
import {
  AUTO_PITCHING_HIGHLIGHTS,
  HOME_AWAY,
  OPPONENTS,
  PHASES,
  RESULTS,
} from '@/lib/constants'
import type {
  GameResult,
  HomeAway,
  Phase,
  PitchingHighlight,
  SavingEntryRow,
  SavingRules,
} from '@/types'

type FormState = {
  game_date: string
  opponent: string
  phase: Phase
  home_away: HomeAway
  /**
   * 球場は入力欄を置かない。日程・結果ページから取れるので、
   * 自動取得がつながれば手で入れる必要がなくなる。
   * ここで保持しているのは、過去に手入力された試合を編集したときに
   * 既存の値を空で上書きしないようにするためだけである。
   */
  stadium: string
  result: GameResult
  /**
   * サヨナラ勝利・ノーヒットノーラン・完全試合・その他ボーナスは、
   * NPB 公式から取得できないため自動登録では扱わない
   * （カスタム登録で積み立てる）。
   *
   * 以下の項目を状態に残しているのは、過去に手入力された試合を
   * 編集したときに既存の値をゼロで上書きしないようにするためだけである。
   */
  is_sayonara: boolean
  marines_score: string
  opponent_score: string
  home_runs: number
  grand_slams: number
  /** マルチ安打と打点も同じ理由で自動登録では扱わない */
  multi_hits: number
  rbi: number
  pitching_highlight: PitchingHighlight
  has_hold: boolean
  has_save: boolean
  other_amount: string
  other_note: string
}

function toForm(entry: SavingEntryRow | null): FormState {
  // カスタム登録（game が null）は GameSheet では編集しないため、新規と同じ初期値にする
  if (!entry || !entry.game) {
    return {
      game_date: today(),
      opponent: 'fighters',
      phase: 'regular',
      home_away: 'home',
      stadium: '',
      result: 'win',
      is_sayonara: false,
      marines_score: '',
      opponent_score: '',
      home_runs: 0,
      grand_slams: 0,
      multi_hits: 0,
      rbi: 0,
      pitching_highlight: 'none',
      has_hold: false,
      has_save: false,
      other_amount: '0',
      other_note: '',
    }
  }
  const g = entry.game
  return {
    game_date: g.game_date,
    opponent: g.opponent,
    phase: g.phase,
    home_away: g.home_away ?? 'home',
    stadium: g.stadium ?? '',
    result: g.result,
    is_sayonara: g.is_sayonara,
    marines_score: g.marines_score === null ? '' : String(g.marines_score),
    opponent_score: g.opponent_score === null ? '' : String(g.opponent_score),
    home_runs: g.home_runs,
    grand_slams: g.grand_slams,
    multi_hits: g.multi_hits ?? 0,
    rbi: g.rbi ?? 0,
    pitching_highlight: g.pitching_highlight,
    has_hold: g.has_hold ?? false,
    has_save: g.has_save,
    // その他ボーナスは試合の持ち物。積立側ではなく試合から読む
    other_amount: String(g.other_amount ?? 0),
    other_note: g.other_note ?? '',
  }
}

export default function GameSheet({
  entry,
  rules,
  userId,
  onClose,
}: {
  entry: SavingEntryRow | null
  rules: SavingRules
  userId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [form, setForm] = useState<FormState>(() => toForm(entry))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const upd = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const otherAmount = Math.max(0, Number.parseInt(form.other_amount || '0', 10) || 0)

  const phaseRuleKey =
    PHASES.find((p) => p.id === form.phase)?.ruleKey ?? 'multiplier_regular'

  const calc = useMemo(
    () =>
      calcSaving(
        {
          phase: form.phase,
          result: form.result,
          is_sayonara: form.result === 'win' && form.is_sayonara,
          home_runs: form.home_runs,
          grand_slams: form.grand_slams,
          multi_hits: form.multi_hits,
          rbi: form.rbi,
          pitching_highlight: form.pitching_highlight,
          has_hold: form.has_hold,
          has_save: form.has_save,
        },
        rules,
        otherAmount
      ),
    [form, rules, otherAmount]
  )

  const save = async () => {
    setSaving(true)
    setError(null)
    const supabase = createClient()

    const toScore = (raw: string) => {
      const parsed = Number.parseInt(raw, 10)
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
    }

    const gamePayload = {
      game_date: form.game_date,
      opponent: form.opponent,
      phase: form.phase,
      home_away: form.home_away,
      stadium: form.stadium.trim(),
      result: form.result,
      is_sayonara: form.result === 'win' && form.is_sayonara,
      marines_score: toScore(form.marines_score),
      opponent_score: toScore(form.opponent_score),
      home_runs: form.home_runs,
      grand_slams: form.grand_slams,
      multi_hits: form.multi_hits,
      rbi: form.rbi,
      pitching_highlight: form.pitching_highlight,
      has_hold: form.has_hold,
      has_save: form.has_save,
      // その他ボーナスも試合に持たせる。こうしないと、同じ試合なのに
      // 登録した本人にだけ上乗せが付いて、人によって金額が変わる
      other_amount: otherAmount,
      other_note: form.other_note.trim(),
      source: 'manual' as const,
      created_by: userId,
    }

    const { data: game, error: gameError } = await supabase
      .from('games')
      .upsert(gamePayload, { onConflict: 'game_date,opponent' })
      .select()
      .single()

    if (gameError || !game) {
      setError('試合データの保存に失敗しました')
      setSaving(false)
      return
    }

    const { error: entryError } = await supabase.from('saving_entries').upsert(
      {
        user_id: userId,
        game_id: game.id,
        kind: 'game',
        title: '',
        entry_date: form.game_date,
        amount: calc.amount,
        breakdown: calc.lines,
        // 表示と履歴のために積立にも持つが、値は試合から写したもの
        other_amount: game.other_amount,
        other_note: game.other_note,
      },
      { onConflict: 'user_id,game_id' }
    )

    if (entryError) {
      setError('積立額の保存に失敗しました')
      setSaving(false)
      return
    }

    onClose()
    router.refresh()
  }

  return (
    <Sheet
      title={entry ? '試合記録を編集' : '自動登録'}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {error ? <p className="text-[13px] text-danger">{error}</p> : null}
          <Button variant="primary" full onClick={save} disabled={saving}>
            {saving ? '保存中' : entry ? '更新する' : '登録する'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="試合日">
            <input
              type="date"
              value={form.game_date}
              onChange={(e) => upd('game_date', e.target.value)}
              className={inputClassCompact}
            />
          </Field>

          {/*
            倍率は選択肢の中ではなくラベル側に出す。
            半分の幅だと「日本シリーズ ×1.5」が入り切らず、
            閉じているときに倍率が切れて読めなくなるため。
          */}
          <Field label="フェーズ" hint={`×${Number(rules[phaseRuleKey]).toFixed(1)}`}>
            <select
              value={form.phase}
              onChange={withTapFeedback((e) => upd('phase', e.target.value as Phase))}
              className={inputClassCompact}
            >
              {PHASES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="対戦相手">
            <select
              value={form.opponent}
              onChange={withTapFeedback((e) => upd('opponent', e.target.value))}
              className={inputClassCompact}
            >
              {OPPONENTS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="開催">
            <Segmented
              value={form.home_away}
              options={HOME_AWAY}
              onChange={(v) => upd('home_away', v)}
            />
          </Field>
        </div>

        <Field label="試合結果" hint="スコアは任意">
          <div className="flex flex-col gap-2">
            <Segmented value={form.result} options={RESULTS} onChange={(v) => upd('result', v)} />
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={form.marines_score}
                onChange={(e) => upd('marines_score', e.target.value)}
                placeholder="MARINES"
                className={`${inputClassCompact} tnum text-center`}
              />
              <span className="text-fg-mute">-</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={form.opponent_score}
                onChange={(e) => upd('opponent_score', e.target.value)}
                placeholder="OPPONENT"
                className={`${inputClassCompact} tnum text-center`}
              />
            </div>
          </div>
        </Field>

        <Field label="打撃ボーナス" hint="満塁HRはホームランに含めず別に数える">
          <div className="flex flex-col gap-2">
            <InlineRow label="ホームラン" hint={`+¥${rules.home_run_amount}/本`}>
              <Stepper
                label="ホームラン"
                value={form.home_runs}
                onChange={(v) => upd('home_runs', v)}
              />
            </InlineRow>
            <InlineRow label="満塁ホームラン" hint={`+¥${rules.grand_slam_amount}/本`}>
              <Stepper
                label="満塁ホームラン"
                value={form.grand_slams}
                onChange={(v) => upd('grand_slams', v)}
              />
            </InlineRow>
          </div>
        </Field>

        <Field label="投手ボーナス" hint="先発ハイライトは最上位のみ加算">
          <div className="flex flex-col gap-2">
            <select
              value={form.pitching_highlight}
              onChange={withTapFeedback((e) => upd('pitching_highlight', e.target.value as PitchingHighlight))}
              className={inputClassCompact}
            >
              {AUTO_PITCHING_HIGHLIGHTS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <InlineRow label="ホールド" hint={`+¥${rules.hold_amount}`}>
              <Switch
                label="ホールド"
                checked={form.has_hold}
                onChange={(v) => upd('has_hold', v)}
              />
            </InlineRow>
            <InlineRow label="セーブ" hint={`+¥${rules.save_amount}`}>
              <Switch label="セーブ" checked={form.has_save} onChange={(v) => upd('has_save', v)} />
            </InlineRow>
          </div>
        </Field>

        <div className="glass rounded-2xl p-4">
          <div className="eyebrow">This game</div>
          <div className="mt-2 divide-hairline">
            {calc.lines.length === 0 ? (
              <p className="py-2 text-[13px] text-fg-mute">加算対象がありません</p>
            ) : (
              calc.lines.map((line) => (
                <Row key={line.key} label={line.label} value={`+¥${line.amount.toLocaleString()}`} />
              ))
            )}
            <Row label="小計" value={`¥${calc.subtotal.toLocaleString()}`} />
            <Row label="フェーズ倍率" value={`×${calc.multiplier.toFixed(1)}`} />
          </div>
          <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
            <span className="eyebrow">積立予定額</span>
            <Amount value={calc.amount} size="lg" tone="marine" />
          </div>
        </div>
      </div>
    </Sheet>
  )
}
