import { NextResponse } from 'next/server'

import { runNpbSync } from '@/lib/npb/sync'
import { isJstMonthEnd, jstMonth, jstYesterday } from '@/lib/jst'
import {
  messageForGameImported,
  messageForGameNeedsManual,
  messageForMilestones,
  messageForMonthEnd,
} from '@/lib/notifications'
import { registerYesterdayGame } from '@/lib/npb/register'
import { snapshotSourcePages } from '@/lib/npb/pages'
import { registerMilestones } from '@/lib/npb/milestone-register'
import { refreshStandings, saveLeagueGames } from '@/lib/npb/league'
import { fillFutureMonths } from '@/lib/npb/schedule-refresh'
import { jstDate } from '@/lib/jst'
import { opponentLabel } from '@/lib/constants'
import { sendPushToAll } from '@/lib/push'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * npb.jp からの日次取得。
 *
 * Vercel Cron から日本時間の 05:00（UTC 20:00）に呼ばれる。
 * 全試合が終わったあとに走らせたいので、深夜の試合が長引いても
 * 間に合う時刻にしている。
 *
 * 取得したものは npb_games と npb_player_stat_snapshots に貯め、
 * そのうち「前日に終わった1試合」だけを games と各自の積立へ入れる。
 * 過去分をまとめて作り直すことはしない。想定しない書き換えが起きたときに
 * 追えなくなるため。すでにある試合と積立にも触らない。
 */

// 取得したものをそのまま保存するので、キャッシュさせない
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 呼び出し元を確かめる。
 *
 * Vercel Cron は Authorization: Bearer <CRON_SECRET> を付けて呼ぶ。
 * 手で叩いて確認したいときも同じヘッダーを使う。
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    // 設定漏れと不正なアクセスを区別しない。存在を教えないため
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // 環境変数の設定漏れをここで拾う。try の外で例外にすると
  // 本文の無い 500 になり、何が足りないのか分からなくなる
  let supabase: ReturnType<typeof createAdminClient>
  try {
    supabase = createAdminClient()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }

  const { data: run, error: runError } = await supabase
    .from('npb_sync_runs')
    .insert({ ok: false })
    .select('id')
    .single()

  if (runError || !run) {
    return NextResponse.json({ error: '実行ログを作成できませんでした' }, { status: 500 })
  }

  const finish = async (ok: boolean, summary: Record<string, unknown>, error = '') => {
    await supabase
      .from('npb_sync_runs')
      .update({ finished_at: new Date().toISOString(), ok, summary, error })
      .eq('id', run.id)
  }

  const now = new Date()

  try {
    const result = await runNpbSync(now)

    if (result.games.length > 0) {
      const { error } = await supabase
        .from('npb_games')
        .upsert(result.games, { onConflict: 'game_date,home_team,away_team' })
      if (error) throw new Error(`npb_games の保存に失敗しました: ${error.message}`)
    }

    if (result.snapshots.length > 0) {
      const { error } = await supabase
        .from('npb_player_stat_snapshots')
        .upsert(result.snapshots, { onConflict: 'as_of,kind,player_name' })
      if (error) throw new Error(`スナップショットの保存に失敗しました: ${error.message}`)
    }

    // 12球団ぶんの試合と、そこから出す順位。日程ページは1枚で全球団ぶんが
    // 載っているので、ここで保存しても取りに行くページは増えない。
    // 失敗しても取り込み全体は止めない（試合の登録のほうが大事）
    let standings: unknown = null
    try {
      await saveLeagueGames(supabase, result.leagueGames)
      standings = await refreshStandings(supabase, Number(jstDate(now).slice(0, 4)))
    } catch (cause) {
      standings = { error: cause instanceof Error ? cause.message : String(cause) }
    }

    // シーズンの残りの月を少しずつ埋める。1回につき1か月だけ取りに行く
    let future: unknown = null
    try {
      future = await fillFutureMonths(supabase, now)
    } catch (cause) {
      future = { error: cause instanceof Error ? cause.message : String(cause) }
    }

    // 前日の1試合だけを貯金へ入れる。ここで初めて金額が動く
    const yesterday = jstYesterday(now)
    const registered = await registerYesterdayGame(supabase, yesterday)
    const notified: Record<string, unknown> = {}

    if (registered.status === 'created' && registered.opponent && registered.result) {
      notified.games = await sendPushToAll(
        messageForGameImported(
          opponentLabel(registered.opponent),
          registered.result as 'win' | 'lose' | 'draw'
        )
      )
    } else if (registered.needsManual && registered.reason) {
      // 黙って見送ると、その日の貯金が抜けたことに気付けない
      notified.games = await sendPushToAll(messageForGameNeedsManual(registered.reason))
    }

    // 記録達成。ページを取り直してから読み取り、達成していれば積立まで作る。
    // 失敗しても取り込み全体は止めない（試合の登録のほうが大事）
    const season = Number(jstDate(now).slice(0, 4))
    let sourcePages: unknown = null
    let milestones: unknown = null
    try {
      sourcePages = await snapshotSourcePages(supabase, season)
      const registered = await registerMilestones(supabase, season)
      milestones = registered
      if (registered.created > 0) {
        notified.milestones = await sendPushToAll(messageForMilestones(registered.titles))
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (sourcePages === null) sourcePages = { error: message }
      else milestones = { error: message }
    }

    // 月末の確定と入金のリマインド。日本時間で月の最終日にだけ送る
    if (isJstMonthEnd(now)) {
      notified.monthEnd = await sendPushToAll(messageForMonthEnd(jstMonth(now)))
    }

    const summary = {
      pages: result.pages,
      games: result.games.length,
      snapshots: result.snapshots.length,
      battingAsOf: result.battingAsOf,
      pitchingAsOf: result.pitchingAsOf,
      warnings: result.warnings,
      registered,
      future,
      standings,
      sourcePages,
      milestones,
      notified,
    }

    // 警告があっても保存自体は成功しているので ok にする。
    // 見直せるように summary には必ず残す。
    await finish(true, summary)
    return NextResponse.json({ ok: true, ...summary })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    await finish(false, {}, message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
