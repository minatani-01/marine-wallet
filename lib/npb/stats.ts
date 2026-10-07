/**
 * チーム別 個人成績（シーズン累計）のパーサー。
 *
 *   https://npb.jp/bis/2026/stats/idb1_m.html   個人打撃（マリーンズ）
 *   https://npb.jp/bis/2026/stats/idp1_m.html   個人投手（マリーンズ）
 *
 * ページには「2026年9月13日 現在」という基準日があり、前日終了時点の累計になる。
 * 1試合ごとの成績は公開されていないため、このスナップショットの日次差分を
 * その日の成績として扱う（docs/npb-data-sources.md 4章）。
 */

import { inningsToOuts, match1, nameText, text, toInt } from './html'

export type PlayerStatRow = {
  playerName: string
  /** 左打ち / 左投げ（名前の先頭に * が付く） */
  isLeft: boolean
  /** 見出しの列名 -> 数値。率（打率など）は文字列のままにせず除外する */
  stats: Record<string, number>
}

export type StatSnapshot = {
  /** 基準日 YYYY-MM-DD。取得した日ではない */
  asOf: string | null
  /**
   * 基準日をページから読めたか。
   *
   * シーズン中は「◯年◯月◯日現在」が載っているが、最終戦が終わると
   * この表記ごと消え、確定版になる。そのときは呼び出し側が渡した
   * 最終戦の日付を使うので、どちらだったかを残しておく。
   */
  asOfFromPage: boolean
  /** 見出し行の列名（選手を除く） */
  columns: string[]
  rows: PlayerStatRow[]
  /** 列数が合わずに捨てた行の数。0 でなければページ構造を疑う */
  skipped: number
}

/**
 * 見出しの表記をそのままキーにすると扱いづらいので、
 * 貯金ルールで使う列だけ英名に寄せる。ここに無い列は日本語のまま入れる。
 */
const COLUMN_ALIASES: Record<string, string> = {
  試合: 'games',
  安打: 'hits',
  打点: 'rbi',
  本塁打: 'home_runs',
  登板: 'appearances',
  勝利: 'wins',
  敗北: 'losses',
  セーブ: 'saves',
  完投: 'complete_games',
  完封勝: 'shutouts',
  自責点: 'earned_runs',
  投球回: 'innings_outs',
}

function aliasOf(column: string): string {
  return COLUMN_ALIASES[column] ?? column
}

/** 「.212」「3.83」のような率は差分の意味を持たないので数値化しない */
function isRateColumn(column: string): boolean {
  return ['打率', '長打率', '出塁率', '勝率', '防御率'].includes(column)
}

/**
 * ページ構造が変わったことに気づけるように、必ずあるはずの列を決めておく。
 * 取得できなければ例外にして、静かに空のスナップショットを保存しないようにする。
 */
const REQUIRED_COLUMNS: Record<'batting' | 'pitching', string[]> = {
  batting: ['試合', '安打', '打点', '本塁打'],
  pitching: ['登板', '勝利', '完封勝', '投球回', '自責点'],
}

/**
 * @param fallbackAsOf ページに基準日が無いときに使う日付。最終戦の日を渡す。
 *   シーズンが終わると「◯年◯月◯日現在」が消え、確定版の数字だけになる。
 *   そのまま読み飛ばすと最終戦ぶんの成績を取り込めない。
 */
export function parseTeamStats(
  html: string,
  kind: 'batting' | 'pitching',
  fallbackAsOf: string | null = null
): StatSnapshot {
  const asOfMatch = html.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*現在/)
  const asOfFromPage = asOfMatch !== null
  const asOf = asOfMatch
    ? `${asOfMatch[1]}-${asOfMatch[2].padStart(2, '0')}-${asOfMatch[3].padStart(2, '0')}`
    : fallbackAsOf

  const table = match1(html, /<table class="tablefix2">([\s\S]*?)<\/table>/) ?? ''
  const thead = match1(table, /<thead[^>]*>([\s\S]*?)<\/thead>/) ?? ''

  // 先頭の <th class="name">選手</th> は列名に含めない
  const headers: string[] = []
  for (const m of thead.matchAll(/<th(?:\s[^>]*)?>([\s\S]*?)<\/th>/g)) {
    headers.push(text(m[1]))
  }
  const columns = headers.slice(1)

  const missing = REQUIRED_COLUMNS[kind].filter((c) => !columns.includes(c))
  if (missing.length > 0) {
    throw new Error(
      `npb.jp の${kind === 'batting' ? '打撃' : '投手'}成績ページの構造が変わっています。` +
        `見つからない列: ${missing.join(', ')}`
    )
  }

  const tbody = match1(table, /<tbody>([\s\S]*?)<\/tbody>/) ?? ''
  const rows: PlayerStatRow[] = []
  let skipped = 0

  for (const rowHtml of tbody.split('<tr>')) {
    const cells: string[] = []
    for (const m of rowHtml.matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/g)) {
      cells.push(m[1])
    }
    // 列数が見出しとぴったり合う行だけを採る。
    // 多すぎる場合も弾く。行の区切りを取り違えて別の選手のセルが
    // 混ざったまま、それらしい数字が入ってしまうのを防ぐため。
    if (cells.length !== columns.length + 1) {
      if (cells.length > 0) skipped += 1
      continue
    }

    // 名前セル。左打ち / 左投げは <sup>*</sup> が付く
    const nameCell = cells[0]
    const isLeft = /<sup>\s*\*\s*<\/sup>/.test(nameCell)
    const playerName = nameText(nameCell.replace(/<sup>[\s\S]*?<\/sup>/g, ''))
    if (!playerName) continue

    const stats: Record<string, number> = {}
    columns.forEach((column, i) => {
      const cell = cells[i + 1]
      if (cell === undefined) return
      if (isRateColumn(column)) return

      if (column === '投球回') {
        // <span class="integer">15</span><span class="decimal">.1</span>
        const outs = inningsToOuts(text(cell))
        if (outs !== null) stats[aliasOf(column)] = outs
        return
      }

      const value = toInt(text(cell))
      if (value !== null) stats[aliasOf(column)] = value
    })

    rows.push({ playerName, isLeft, stats })
  }

  if (rows.length === 0) {
    throw new Error(
      `npb.jp の${kind === 'batting' ? '打撃' : '投手'}成績ページから選手行を取れませんでした。`
    )
  }

  return { asOf, asOfFromPage, columns, rows, skipped }
}
