import { calcSaving } from '@/lib/savings'
import { DEFAULT_SAVING_RULES } from '@/lib/savings'
import { gameFromNpb } from '@/lib/npb/import'
import type { NpbGameSource } from '@/lib/npb/import'
import type { SavingRules } from '@/types'
import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * 前日に終わった試合を、貯金が見る `games` と各自の積立へ入れる。
 *
 * 前日の1日ぶんだけを見る。過去分をまとめて作り直すと、想定しない
 * 書き換えが起きたときに追えなくなるため。
 *
 * 追加しかしない。すでに `games` にその日の試合があれば、手で登録した
 * ものか編集したものなので、何もせずに見送る。毎朝走る処理が既存の
 * 記録を上書きしないようにしておく。
 */

type Admin = ReturnType<typeof createAdminClient>

export type RegisterResult = {
  /** 何をしたか。実行ログに残して、あとから追えるようにする */
  status: 'created' | 'skipped'
  game_date: string
  /** skipped のときの理由。人が手で入れる目印になる */
  reason?: string
  /**
   * 見送ったうえで、人が手で入れる必要があるか。
   *
   * 試合が無い日・中止・すでに登録済みは普通のことなので知らせない。
   * 判別できなかったものだけ知らせて、取りこぼしに気付けるようにする。
   */
  needsManual?: boolean
  opponent?: string
  result?: string
  amount?: number
  /** 積立を作った人数 */
  users?: number
}

/** numeric 型は文字列で返るため数値に直す */
function toRules(row: Record<string, unknown> | null): SavingRules {
  if (!row) return { ...DEFAULT_SAVING_RULES }
  return {
    ...(row as unknown as SavingRules),
    multiplier_regular: Number(row.multiplier_regular),
    multiplier_interleague: Number(row.multiplier_interleague),
    multiplier_cs: Number(row.multiplier_cs),
    multiplier_nippon_series: Number(row.multiplier_nippon_series),
  }
}

export async function registerYesterdayGame(
  supabase: Admin,
  yesterday: string
): Promise<RegisterResult> {
  const { data: rows, error: readError } = await supabase
    .from('npb_games')
    .select(
      'game_date, home_team, away_team, home_score, away_score, place, phase, status, save_pitcher, raw'
    )
    .eq('game_date', yesterday)

  if (readError) {
    return {
      status: 'skipped',
      game_date: yesterday,
      reason: `取得データを読めません: ${readError.message}`,
      needsManual: true,
    }
  }
  if (!rows || rows.length === 0) {
    return { status: 'skipped', game_date: yesterday, reason: '前日に試合がありません' }
  }
  // ダブルヘッダーは今のところ無い。複数あれば人が見たほうがよい
  if (rows.length > 1) {
    return {
      status: 'skipped',
      game_date: yesterday,
      reason: `1日に${rows.length}試合あります`,
      needsManual: true,
    }
  }

  const imported = gameFromNpb(rows[0] as unknown as NpbGameSource)
  if (!imported.ok) {
    // 中止で得点が入らないのは普通のこと。それ以外は人に見てもらう
    const isNormal = imported.reason.includes('得点が入っていません')
    return {
      status: 'skipped',
      game_date: yesterday,
      reason: imported.reason,
      needsManual: !isNormal,
    }
  }
  const game = imported.game

  // すでにある試合には触らない。手で入れたもの・直したものを上書きしない
  const { data: existing } = await supabase
    .from('games')
    .select('id')
    .eq('game_date', game.game_date)
    .eq('opponent', game.opponent)
    .maybeSingle()

  if (existing) {
    return {
      status: 'skipped',
      game_date: yesterday,
      opponent: game.opponent,
      reason: 'すでに登録されています',
    }
  }

  const { data: created, error: insertError } = await supabase
    .from('games')
    .insert({ ...game, created_by: null })
    .select('id')
    .single()

  if (insertError || !created) {
    throw new Error(`試合を登録できませんでした: ${insertError?.message ?? '不明'}`)
  }

  // 貯金ルールは全員で共通の1行
  const { data: ruleRow } = await supabase
    .from('saving_rule_settings')
    .select('*')
    .eq('id', true)
    .maybeSingle()
  const rules = toRules(ruleRow as Record<string, unknown> | null)

  // 確定と同じ顔ぶれにする（マスターと、貯金に参加している接続済みメンバー）
  const { data: targets, error: targetError } = await supabase.rpc('saving_target_users')
  if (targetError) {
    throw new Error(`積立の対象を取得できませんでした: ${targetError.message}`)
  }

  const userIds = [
    ...new Set(
      (targets ?? []).map((row: unknown) =>
        typeof row === 'string' ? row : ((row as { saving_target_users?: string }).saving_target_users ?? '')
      )
    ),
  ].filter(Boolean) as string[]

  const calc = calcSaving(game, rules, game.other_amount)

  if (userIds.length > 0) {
    const { error: entryError } = await supabase.from('saving_entries').upsert(
      userIds.map((userId) => ({
        user_id: userId,
        game_id: created.id,
        kind: 'game' as const,
        title: '',
        entry_date: game.game_date,
        amount: calc.amount,
        breakdown: calc.lines,
        other_amount: game.other_amount,
        other_note: game.other_note,
      })),
      // 既にある積立は触らない。手で直した金額を毎朝戻さないため
      { onConflict: 'user_id,game_id', ignoreDuplicates: true }
    )
    if (entryError) {
      throw new Error(`積立を登録できませんでした: ${entryError.message}`)
    }
  }

  return {
    status: 'created',
    game_date: game.game_date,
    opponent: game.opponent,
    result: game.result,
    amount: calc.amount,
    users: userIds.length,
  }
}
