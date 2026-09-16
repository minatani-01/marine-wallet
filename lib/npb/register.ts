import { gameFromNpb } from '@/lib/npb/import'
import type { NpbGameSource } from '@/lib/npb/import'
import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * 前日に終わった試合を、貯金が見る `games` へ入れる。
 *
 * 前日の1日ぶんだけを見る。過去分をまとめて作り直すと、想定しない
 * 書き換えが起きたときに追えなくなるため。
 *
 * 追加しかしない。すでに `games` にその日の試合があれば、手で登録した
 * ものか編集したものなので、何もせずに見送る。毎朝走る処理が既存の
 * 記録を上書きしないようにしておく。
 *
 * 積立はここでは作らない。`games` に行が入ると DB のトリガー
 * （games_sync_saving_entries → sync_saving_entries_for_game）が
 * 対象者ぶんをまとめて作る。金額の計算を2か所に置くと必ず食い違うので、
 * 試合を入れるところまでで手を止める。
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
  /** トリガーが作った積立の数。0なら対象者が居ない */
  entries?: number
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

  // トリガーが作った積立を数えて、実行ログに残す
  const { count } = await supabase
    .from('saving_entries')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', created.id)

  return {
    status: 'created',
    game_date: game.game_date,
    opponent: game.opponent,
    result: game.result,
    entries: count ?? 0,
  }
}
