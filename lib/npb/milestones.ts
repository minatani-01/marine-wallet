import { decodeEntities, text, toInt } from '@/lib/npb/html'
import type { StatSnapshot } from '@/lib/npb/stats'

/**
 * 記録達成の読み取り。
 *
 * 対象は2種類ある。
 *
 *   通算記録   /history/<年>/milestones_b|p|team.html
 *              記録ごとに見出しがあり、その下に表が2つ並ぶ。
 *              「達成済み」の表には達成日が入るので、前日と比べなくても
 *              達成が分かる（docs/npb-data-sources.md 8.2）。
 *
 *   シーズン記録 /bis/<年>/stats/idb1_m.html・idp1_m.html
 *              個人成績の累計。節目に届いた選手を拾う。
 *              達成日は公開されないので、ページの基準日を達成日とする。
 *
 * ここは純関数にしてある。DB も時計も触らないので、実データを貼って
 * テストで確かめられる。
 *
 * 背番号は記録のページにも成績のページにも無い。選手名鑑から引く。
 */

/** 所属の列でマリーンズを指す表記 */
const MARINES_AFFILIATION = 'ロッテ'

/** チーム記録のページでの球団名 */
const MARINES_TEAM_NAME = '千葉ロッテマリーンズ'

/** 名球会の入会条件。同じ通算記録でも重みが違うので分けて扱う */
export const MEIKYUKAI_RECORDS = ['2000安打', '200勝利', '250セーブ'] as const

export type MilestoneTier = '名球会記録' | '生涯記録' | 'シーズン記録'

export type Milestone = {
  /** career = 通算記録のページ / season = 個人成績から見つけたシーズン記録 */
  source: 'career' | 'season'
  kind: 'batting' | 'pitching' | 'team'
  /** npb.jp の見出しそのまま（例: 250セーブ / シーズン30本塁打） */
  recordLabel: string
  /** 達成した人。チーム記録なら球団名 */
  holder: string
  achievedOn: string
  tier: MilestoneTier
}

/** 空白を全て落とす。名鑑は全角スペース、記録のページは半角と揺れる */
function squash(value: string): string {
  return value.replace(/[\s　]+/g, '')
}

/**
 * 表示に使う姓。
 *
 * 「益田 直也」なら「益田」。区切りが無いカタカナ名（ソト）はそのまま。
 */
export function familyName(playerName: string): string {
  const parts = playerName.trim().split(/[\s　]+/).filter(Boolean)
  return parts[0] ?? playerName.trim()
}

// ----------------------------------------------------------------------------
// 選手名鑑
// ----------------------------------------------------------------------------

export type RosterEntry = {
  /** 空白を落とした氏名。引き当てのキーにする */
  key: string
  name: string
  number: string
}

/**
 * 選手名鑑から 氏名 -> 背番号 を作る。
 *
 *   <tr class="rosterPlayer"><td>52</td>
 *     <td class="rosterRegister"><a href="...">益田　直也</a></td>...
 *
 * 監督・コーチは <a> を持たない行で出るが、同じ形なので一緒に拾える。
 */
export function parseRoster(html: string): RosterEntry[] {
  const out: RosterEntry[] = []
  const re =
    /<tr class="rosterPlayer">\s*<td>([^<]*)<\/td>\s*<td class="rosterRegister">([\s\S]*?)<\/td>/g

  for (const m of html.matchAll(re)) {
    const number = text(m[1])
    const name = decodeEntities(m[2].replace(/<[^>]*>/g, '')).trim()
    const key = squash(name)
    if (!key) continue
    out.push({ key, name, number })
  }
  return out
}

/** 名鑑から背番号を引く。見つからなければ空（内容に「#」を書かない） */
export function uniformNumberOf(roster: RosterEntry[], playerName: string): string {
  const key = squash(playerName)
  return roster.find((r) => r.key === key)?.number ?? ''
}

/** 積立に残す内容。例: `#52益田 通算250セーブ記念` */
export function milestoneTitle(milestone: Milestone, uniformNumber: string): string {
  if (milestone.kind === 'team') {
    return `マリーンズ ${milestone.recordLabel}記念`
  }
  const prefix = uniformNumber ? `#${uniformNumber}` : ''
  const who = `${prefix}${familyName(milestone.holder)}`
  const what =
    milestone.source === 'career' ? `通算${milestone.recordLabel}` : milestone.recordLabel
  return `${who} ${what}記念`
}

// ----------------------------------------------------------------------------
// 通算記録
// ----------------------------------------------------------------------------

/** 「2026.8.4」を「2026-08-04」に直す。読めなければ null */
export function parseAchievedDate(raw: string): string | null {
  const m = squash(raw).match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/)
  if (!m) return null
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

/** 見出しから記録名を取る。「250セーブ（過去4人）」→「250セーブ」 */
function recordLabelOf(heading: string): string {
  return text(heading).replace(/[（(].*$/, '').trim()
}

function tierOf(recordLabel: string): MilestoneTier {
  return (MEIKYUKAI_RECORDS as readonly string[]).includes(recordLabel)
    ? '名球会記録'
    : '生涯記録'
}

type Table = { headers: string[]; rows: string[][] }

/** colspan="2" なら2列ぶん。属性が無ければ1列 */
function colspanOf(attrs: string | undefined): number {
  const n = Number.parseInt(attrs?.match(/colspan="?(\d+)"?/)?.[1] ?? '1', 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

/**
 * 表を1つ読む。1列目は <th>、残りは <td>。
 *
 * 見出しと列数が合わない行は捨てる。別の行のセルが混ざるのを防ぐため。
 * ただし npb.jp はセルを横につなぐことがある。
 *
 *   <td colspan="2">走者・源田壮亮の盗塁刺</td>   （打者と結果をまとめた）
 *
 * つないだぶんを数えないと列数が合わず、行ごと落としてしまう。
 * 実際それで小島の通算1000投球回を取りこぼした。つないだ列は
 * 空文字で埋めて、位置がずれないようにする。
 */
function parseTable(tableHtml: string): Table {
  const headers: string[] = []
  const thead = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/)?.[1] ?? ''
  for (const m of thead.matchAll(/<th(\s[^>]*)?>([\s\S]*?)<\/th>/g)) {
    headers.push(text(m[2]))
    for (let i = 1; i < colspanOf(m[1]); i += 1) headers.push('')
  }

  const tbody = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)?.[1] ?? ''
  const rows: string[][] = []

  for (const rowHtml of tbody.split(/<tr[^>]*>/).slice(1)) {
    const head = rowHtml.match(/<th(?:\s[^>]*)?>([\s\S]*?)<\/th>/)?.[1]
    if (head === undefined) continue

    const cells = [text(head)]
    for (const m of rowHtml.matchAll(/<td(\s[^>]*)?>([\s\S]*?)<\/td>/g)) {
      cells.push(text(m[2]))
      for (let i = 1; i < colspanOf(m[1]); i += 1) cells.push('')
    }

    if (cells.length !== headers.length) continue
    rows.push(cells)
  }

  return { headers, rows }
}

/**
 * 通算記録のページから、マリーンズの達成を拾う。
 *
 * 「ロッテ」は所属以外の欄にも出る。相手チームとして出ることもあれば、
 * 他球団へ移った選手の「当時の所属」として出ることもある。
 * そのため所属（チーム記録ではチーム）の列だけを見る。
 *
 * 達成日の列を持つ表だけを見る。もう一方の「これから」の表には
 * 達成日が無く、達成しても `達成まで` が「達成」に変わるだけで日が分からない。
 */
export function parseCareerMilestones(
  html: string,
  kind: 'batting' | 'pitching' | 'team'
): Milestone[] {
  const out: Milestone[] = []

  for (const block of html.split(/<div class="wrap">/).slice(1)) {
    const heading = block.match(/<h4[^>]*>([\s\S]*?)<\/h4>/)?.[1]
    if (!heading) continue
    const recordLabel = recordLabelOf(heading)
    if (!recordLabel) continue

    for (const m of block.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)) {
      const table = parseTable(m[1])

      const dateAt = table.headers.indexOf('達成日')
      if (dateAt < 0) continue

      // 選手のページは「氏名 / 所属」、チームのページは「チーム」だけ
      const teamAt = kind === 'team' ? 0 : table.headers.indexOf('所属')
      if (teamAt < 0) continue

      for (const row of table.rows) {
        const team = squash(row[teamAt] ?? '')
        const isMarines =
          kind === 'team' ? team === squash(MARINES_TEAM_NAME) : team === MARINES_AFFILIATION
        if (!isMarines) continue

        const achievedOn = parseAchievedDate(row[dateAt] ?? '')
        if (!achievedOn) continue

        out.push({
          source: 'career',
          kind,
          recordLabel,
          holder: row[0]?.trim() ?? '',
          achievedOn,
          tier: kind === 'team' ? '生涯記録' : tierOf(recordLabel),
        })
      }
    }
  }

  return out
}

// ----------------------------------------------------------------------------
// シーズン記録
// ----------------------------------------------------------------------------

/**
 * 節目とする数字。
 *
 * 通算記録のページには載らないので、ここは自分たちで決める。
 * 「その年の主役になった」と言える水準に置いてある。
 * 金額はどれも シーズン記録 の定型が持つので、ここでは重みを分けない。
 */
export const SEASON_THRESHOLDS: Record<
  'batting' | 'pitching',
  { key: string; unit: string; values: number[] }[]
> = {
  batting: [
    { key: 'home_runs', unit: '本塁打', values: [30, 40, 50] },
    { key: 'rbi', unit: '打点', values: [100] },
    { key: 'hits', unit: '安打', values: [150, 200] },
    { key: '盗塁', unit: '盗塁', values: [30, 50] },
  ],
  pitching: [
    { key: 'wins', unit: '勝利', values: [15, 20] },
    { key: 'saves', unit: 'セーブ', values: [30, 40] },
    { key: 'ホールド', unit: 'ホールド', values: [30, 40] },
    { key: '三振', unit: '奪三振', values: [150, 200] },
  ],
}

/**
 * 個人成績のスナップショットから、節目に届いた選手を拾う。
 *
 * 達成日はページの基準日にする。NPB は1試合ごとの個人成績を公開しておらず、
 * 何日に届いたかは分からない。基準日は前日終了時点なので、遅くともその日には
 * 届いている（docs/npb-data-sources.md 4章）。
 */
export function parseSeasonMilestones(
  snapshot: StatSnapshot,
  kind: 'batting' | 'pitching'
): Milestone[] {
  if (!snapshot.asOf) return []
  const out: Milestone[] = []

  for (const row of snapshot.rows) {
    for (const threshold of SEASON_THRESHOLDS[kind]) {
      const value = row.stats[threshold.key]
      if (typeof value !== 'number') continue

      for (const target of threshold.values) {
        if (value < target) continue
        out.push({
          source: 'season',
          kind,
          recordLabel: `シーズン${target}${threshold.unit}`,
          holder: row.playerName,
          achievedOn: snapshot.asOf,
          tier: 'シーズン記録',
        })
      }
    }
  }

  return out
}

// ----------------------------------------------------------------------------
// まもなく達成する記録
// ----------------------------------------------------------------------------

/**
 * 記録名から 目標の数 と 単位 を取り出す。
 * 「250セーブ」→ 250 / セーブ 、「1000試合出場」→ 1000 / 試合出場
 */
export function splitRecordLabel(recordLabel: string): { target: number; unit: string } | null {
  const m = squash(recordLabel).match(/^(\d+)(.+)$/)
  if (!m) return null
  return { target: Number.parseInt(m[1], 10), unit: m[2] }
}

/**
 * 記録の単位と、個人成績の列の対応。
 *
 * 打撃と投手で同じ名前の列があるので（本塁打は投手だと被本塁打）、
 * ページの種類ごとに分けて持つ。ここに無い単位は今季ぶんを足せないので、
 * カウントダウンの対象から外す。
 */
const SEASON_STAT_KEY: Record<'batting' | 'pitching', Record<string, string>> = {
  batting: {
    試合出場: 'games',
    得点: '得点',
    安打: 'hits',
    二塁打: '二塁打',
    三塁打: '三塁打',
    本塁打: 'home_runs',
    塁打: '塁打',
    打点: 'rbi',
    盗塁: '盗塁',
    犠打: '犠打',
    犠飛: '犠飛',
    四球: '四球',
    死球: '死球',
    三振: '三振',
  },
  pitching: {
    試合登板: 'appearances',
    勝利: 'wins',
    セーブ: 'saves',
    ホールド: 'ホールド',
    奪三振: '三振',
    // 投球回は入れない。記録のページの「昨年まで」が 989.1 のような
    // 三進法の小数で、成績のほうはアウト数。単位を揃える手間に見合わない
  },
}

export type UpcomingMilestone = {
  kind: 'batting' | 'pitching'
  recordLabel: string
  holder: string
  target: number
  unit: string
  /** 昨年までの通算 */
  through: number
  /** 今季ぶん */
  season: number
  /** 通算（昨年まで + 今季） */
  current: number
  /** あと何本・何勝 */
  remaining: number
}

/**
 * 「これから」の表から、マリーンズの選手のカウントダウンを作る。
 *
 * ページの「達成まで」の列は使わない。あれは 目標 − 昨年まで で、
 * 今季ぶんが入っていない（達成すると「達成」に変わるだけ）。
 * そのままだと開幕直後の数字を出し続けることになるので、
 * 昨年までの数に、こちらで持っている今季の成績を足して数え直す。
 *
 * @param stats 今季の個人成績。選手名（空白を落としたもの）で引く
 */
export function parseUpcomingMilestones(
  html: string,
  kind: 'batting' | 'pitching',
  stats: Map<string, Record<string, number>>
): UpcomingMilestone[] {
  const out: UpcomingMilestone[] = []

  for (const block of html.split(/<div class="wrap">/).slice(1)) {
    const heading = block.match(/<h4[^>]*>([\s\S]*?)<\/h4>/)?.[1]
    if (!heading) continue

    const recordLabel = recordLabelOf(heading)
    const parsed = splitRecordLabel(recordLabel)
    if (!parsed) continue

    const statKey = SEASON_STAT_KEY[kind][parsed.unit]
    if (!statKey) continue

    for (const m of block.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)) {
      const table = parseTable(m[1])

      // 「達成済み」の表には達成日がある。こちらが見たいのは残りのほう
      if (table.headers.includes('達成日')) continue
      const throughAt = table.headers.indexOf('昨年まで')
      const teamAt = table.headers.indexOf('所属')
      const leftAt = table.headers.indexOf('達成まで')
      if (throughAt < 0 || teamAt < 0) continue

      for (const row of table.rows) {
        if (squash(row[teamAt] ?? '') !== MARINES_AFFILIATION) continue

        // 達成すると「達成まで」が数字から「達成」に変わる。
        // 成績を引けないときでも、達成済みをカウントダウンに出さないための印
        if (leftAt >= 0 && squash(row[leftAt] ?? '').includes('達成')) continue

        const through = toInt(row[throughAt] ?? '')
        if (through === null) continue

        const holder = row[0]?.trim() ?? ''
        const season = stats.get(squash(holder))?.[statKey] ?? 0
        const current = through + season
        const remaining = parsed.target - current
        // すでに越えているものは達成済みの表が持つ。ここでは出さない
        if (remaining <= 0) continue

        out.push({
          kind,
          recordLabel,
          holder,
          target: parsed.target,
          unit: parsed.unit,
          through,
          season,
          current,
          remaining,
        })
      }
    }
  }

  // 同じ選手が複数の節目に並ぶので、近いものから
  return out.sort((a, b) => a.remaining - b.remaining)
}

/** 数字が読めるかの確認に使う（テストから参照する） */
export const __internal = { squash, parseTable, recordLabelOf, toInt }
