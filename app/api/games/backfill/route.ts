import { NextResponse } from 'next/server'

import { getProfile, getSessionUser } from '@/lib/queries'
import { backfillGames } from '@/lib/npb/backfill'
import { collectBoxScores, collectMissingMonths, repairGames } from '@/lib/npb/repair'
import { collectLeagueMonths, refreshStandings } from '@/lib/npb/league'
import { refreshSchedule, remainingMonths, sweepPastScheduled } from '@/lib/npb/schedule-refresh'
import { jstDate } from '@/lib/jst'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * 取りこぼした試合を拾い、すでにある試合を npb.jp の内容に合わせて直す。
 *
 * 毎朝の取り込みは前日の1試合だけを見るので、仕組みを作る前に終わった試合や、
 * 取り込みに失敗した試合は残ったままになる。ここはそれを拾うための、
 * 人が押して動かす口。
 *
 * 6段構えで動く。
 *   0. シーズンの残りの日程を取り直す（中止はその日に決まるので、翌朝を待たない）
 *   1. 取得データの無い月の日程・結果を取る（1回につき3か月まで）
 *   2. ボックススコアをまだ取っていない試合を取る（1回につき8試合まで）
 *   3. すでにある試合の、金額に関わらない項目を直す
 *   4. まだ登録していない試合を取り込む
 *   5. 順位のために、12球団ぶんの日程を取る（1回につき3か月まで）
 *
 * 3 で直すのは 対戦相手 / ホーム・ビジター / 球場 / 得点 だけで、
 * 勝敗もフェーズも本塁打も触らない。この操作で金額は動かない。
 * 金額に効く項目の食い違いは、直さずに件数だけ知らせる。
 *
 * マスターだけが押せる。試合は全員で共有するデータなので、
 * 誰でも増やせる状態にはしない。
 *
 * npb.jp へ出られるのは本番のサーバーだけなので、取得はここで行う。
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const profile = await getProfile(user.id)
  if (!profile?.is_master) {
    return NextResponse.json({ error: 'マスターのみ実行できます' }, { status: 403 })
  }

  // 設定漏れをここで拾う。try の外で例外にすると本文の無い 500 になる
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return NextResponse.json({ error: message }, { status: 503 })
  }

  const now = new Date()
  const season = Number(jstDate(now).slice(0, 4))

  /**
   * 1段ずつ、失敗しても次へ進む。
   *
   * npb.jp が一時的に応答しないだけで全部が止まると、DB の中だけで
   * 終わる処理（中止の直し・順位の計算）まで巻き添えになる。実際、
   * 途中で止まって古い月の中止が直らなかった。
   */
  const errors: Record<string, string> = {}
  const step = async <T,>(name: string, run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run()
    } catch (cause) {
      errors[name] = cause instanceof Error ? cause.message : String(cause)
      return null
    }
  }

  // 0. シーズンの残りの日程を取り直す。中止や開始時刻の変更はその日に決まり、
  //    先の月ぶんもここでまとめて入る
  const schedule = await step('schedule', () =>
    refreshSchedule(admin, now, undefined, remainingMonths(now.getFullYear(), now.getMonth() + 1))
  )

  // 1. 古い月に残った「予定のままの過去の試合」を中止に直す。
  //    npb.jp へは出ないので、取得が失敗した日でも必ず通す
  const swept = await step('swept', () => sweepPastScheduled(admin, jstDate(now)))

  // 2. 取得データの無い月を取りに行く。ここで npb.jp へ出る
  const collected = await step('collected', () => collectMissingMonths(admin, season))

  // 3. 本塁打とセーブを見るためのボックススコア。これも npb.jp へ出る
  const boxes = await step('boxes', () => collectBoxScores(admin, season))

  // 4. すでにある試合を直す。DB の中だけで完結する
  const repaired = await step('repaired', () => repairGames(admin, season))

  // 5. まだ登録していない試合を取り込む
  const result = await step('backfill', () => backfillGames(admin))

  // 6. 順位のための12球団ぶんの日程。仕組みを入れる前の月を埋める。
  //    ここも npb.jp へ出るので、1回に取る月を絞ってある
  const league = await step('league', () => collectLeagueMonths(admin, season))
  const standings = await step('standings', () => refreshStandings(admin, season))

  return NextResponse.json({
    ok: Object.keys(errors).length === 0,
    ...(result ?? {}),
    schedule,
    swept,
    collected,
    boxes,
    repaired,
    league,
    standings,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  })
}
