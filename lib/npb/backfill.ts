import { boxScoreUrl, fetchNpbPage, FETCH_INTERVAL_MS, sleep } from '@/lib/npb/fetch'
import { parseBoxScore } from '@/lib/npb/boxscore'
import { gameFromNpb } from '@/lib/npb/import'
import type { NpbGameSource } from '@/lib/npb/import'
import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * まだ貯金に入っていない試合を、あとからまとめて取り込む。
 *
 * 毎朝の取り込みは前日の1試合だけを見る。それ以前に終わった試合は、
 * 仕組みを作る前のものや、取り込みに失敗したものが残る。
 * ここはその取りこぼしを拾うための、人が押して動かす処理。
 *
 * 毎朝の取り込みと同じで、追加しかしない。すでに `games` にある試合には
 * 触らないので、手で入れたものや直した金額を書き換えることはない。
 *
 * ボックススコアは1試合につき1ページ取りに行く。相手に負担をかけないよう
 * 必ず間隔を空け、1回で扱う数にも上限を置く。足りなければもう一度押せばよい。
 */

type Admin = ReturnType<typeof createAdminClient>

/** 1回で取り込む上限。Vercel の実行時間に収まる範囲にする */
export const BACKFILL_LIMIT = 10

export type BackfillItem = {
  game_date: string
  status: 'created' | 'skipped'
  reason?: string
  opponent?: string
  result?: string
}

export type BackfillResult = {
  /** 取り込めた試合 */
  created: number
  /** 見送った試合 */
  skipped: number
  /** まだ残っている数。0になるまで押せばよい */
  remaining: number
  items: BackfillItem[]
}

type Row = {
  game_date: string
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  place: string
  phase: string
  status: string
  save_pitcher: string
  box_score_path: string
  raw: unknown
}

export async function backfillGames(
  supabase: Admin,
  fetchPage: (url: string) => Promise<string> = fetchNpbPage
): Promise<BackfillResult> {
  // 終わった試合のうち、まだ games に無いものを古い順に
  const { data: npbRows, error: npbError } = await supabase
    .from('npb_games')
    .select(
      'game_date, home_team, away_team, home_score, away_score, place, phase, status, save_pitcher, box_score_path, raw'
    )
    .eq('status', 'finished')
    .order('game_date', { ascending: true })

  if (npbError) throw new Error(`取得データを読めませんでした: ${npbError.message}`)

  const { data: known, error: gamesError } = await supabase.from('games').select('game_date')
  if (gamesError) throw new Error(`登録済みの試合を読めませんでした: ${gamesError.message}`)

  const registered = new Set((known ?? []).map((row) => row.game_date as string))
  const pending = ((npbRows ?? []) as Row[]).filter((row) => !registered.has(row.game_date))
  const targets = pending.slice(0, BACKFILL_LIMIT)

  const items: BackfillItem[] = []

  for (const [index, row] of targets.entries()) {
    if (index > 0) await sleep(FETCH_INTERVAL_MS)

    if (!row.box_score_path) {
      items.push({
        game_date: row.game_date,
        status: 'skipped',
        reason: 'ボックススコアの場所が分かりません',
      })
      continue
    }

    let source: NpbGameSource
    try {
      const html = await fetchPage(boxScoreUrl(row.box_score_path))
      const box = parseBoxScore(html)

      // 取りに行った日付と中身が食い違うなら使わない。別の試合を入れてしまう
      if (box.gameDate && box.gameDate !== row.game_date) {
        items.push({
          game_date: row.game_date,
          status: 'skipped',
          reason: `ボックススコアの日付が違います（${box.gameDate}）`,
        })
        continue
      }

      source = {
        ...row,
        phase: box.phase,
        save_pitcher: box.savePitcher,
        raw: { box: { homeRuns: box.homeRuns } },
      }

      // 取ってきた内容を取得データ側にも残す。あとから見返せるように
      await supabase
        .from('npb_games')
        .update({
          phase: box.phase,
          win_pitcher: box.winPitcher,
          lose_pitcher: box.losePitcher,
          save_pitcher: box.savePitcher,
          raw: {
            ...(typeof row.raw === 'object' && row.raw ? row.raw : {}),
            box: { seriesLabel: box.seriesLabel, state: box.state, homeRuns: box.homeRuns },
          },
        })
        .eq('game_date', row.game_date)
        .eq('home_team', row.home_team)
        .eq('away_team', row.away_team)
    } catch (cause) {
      items.push({
        game_date: row.game_date,
        status: 'skipped',
        reason: `取得できませんでした: ${cause instanceof Error ? cause.message : String(cause)}`,
      })
      continue
    }

    const imported = gameFromNpb(source)
    if (!imported.ok) {
      items.push({ game_date: row.game_date, status: 'skipped', reason: imported.reason })
      continue
    }

    const { error: insertError } = await supabase
      .from('games')
      .insert({ ...imported.game, created_by: null })

    if (insertError) {
      items.push({
        game_date: row.game_date,
        status: 'skipped',
        reason: `登録できませんでした: ${insertError.message}`,
      })
      continue
    }

    items.push({
      game_date: row.game_date,
      status: 'created',
      opponent: imported.game.opponent,
      result: imported.game.result,
    })
  }

  const created = items.filter((i) => i.status === 'created').length
  return {
    created,
    skipped: items.length - created,
    remaining: pending.length - created,
    items,
  }
}
