import { familyName, parseRoster, type RosterEntry } from '@/lib/npb/milestones'

/**
 * その試合で誰が何をしたか。
 *
 * 4つを出す。
 *
 *   本塁打    打った選手と号数。ボックススコアに載っている
 *   勝利投手  ボックススコアに載っている
 *   セーブ    ボックススコアに載っている
 *   ホールド  載っていない。前日との個人成績の差分で出す
 *
 * NPB のボックススコアは責任投手（勝・敗・S）しか書かない。ホールドだけは
 * 毎日まるごと保存している個人投手成績を前日と比べて拾う。npb.jp へ
 * 取りに行くページは増えない。
 *
 * ここは純関数にしてある。DB も時計も触らないので、実データを貼って
 * テストで確かめられる。
 */

/** マリーンズの本塁打を見分けるための、ボックススコアでの球団名 */
const MARINES_IN_BOX = 'ロッテ'

export type Who = {
  /** 名鑑から引いた背番号。引けなければ空 */
  number: string
  /** ボックススコアや成績ページに出ていた名前 */
  name: string
}

export type HomeRunHit = Who & {
  /** 「36号（4回2ラン 早川）」の号数だけ。引けなければ空 */
  no: string
}

export type Contributors = {
  home_runs: HomeRunHit[]
  win: Who | null
  save: Who | null
  /** 同じ試合で2人以上付くことがある */
  holds: Who[]
}

export const EMPTY_CONTRIBUTORS: Contributors = {
  home_runs: [],
  win: null,
  save: null,
  holds: [],
}

/** 空白を全て落とす。名鑑は全角、ボックススコアは半角と揺れる */
function squash(value: string): string {
  return value.replace(/[\s　]+/g, '')
}

/**
 * 名前から背番号を引く。
 *
 * ボックススコアは姓だけ（「山口」）、成績ページはフルネーム（「鈴木　昭汰」）
 * と書き方が違う。どちらでも引けるように2段構えにしてある。
 *
 *   1 そのまま一致      鈴木昭汰 → #47
 *   2 前方一致で1人だけ 山口 → 山口航輝 → #51
 *
 * 同姓が2人いるときは引かない。番号を間違えるくらいなら、出さないほうがよい。
 * ボックススコアも同姓は「松本裕」「松本晴」と書き分けるので、前方一致で足りる。
 */
export function lookupNumber(roster: RosterEntry[], name: string): string {
  const key = squash(name)
  if (!key) return ''

  const exact = roster.find((r) => r.key === key)
  if (exact) return exact.number

  const starts = roster.filter((r) => r.key.startsWith(key))
  return starts.length === 1 ? starts[0].number : ''
}

/**
 * 画面に出す1人。
 *
 * 背番号は渡された名前のまま引く（成績ページはフルネームで、そのほうが
 * 同姓を取り違えない）。出す名前は姓にそろえる。ボックススコアは姓だけ、
 * 成績ページはフルネームなので、そのまま並べると書き方がずれる。
 */
function who(roster: RosterEntry[], name: string): Who | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  return { number: lookupNumber(roster, trimmed), name: familyName(trimmed) }
}

/** 「山口 36号（4回2ラン 早川）」から号数だけ取る */
export function homeRunNumber(detail: string): string {
  return detail.match(/(\d+号)/)?.[1] ?? ''
}

export type BoxHomeRun = { team: string; batter: string; detail: string }

/** マリーンズの本塁打だけを、打った順のまま残す */
export function marinesHomeRuns(
  homeRuns: BoxHomeRun[],
  roster: RosterEntry[]
): HomeRunHit[] {
  return homeRuns
    .filter((hr) => squash(hr.team) === MARINES_IN_BOX)
    .map((hr) => ({
      number: lookupNumber(roster, hr.batter),
      name: familyName(hr.batter),
      no: homeRunNumber(hr.detail),
    }))
}

export type PitcherRow = { player_name: string; stats: Record<string, unknown> }

function holdsOf(row: PitcherRow): number {
  const value = row.stats['ホールド']
  return typeof value === 'number' ? value : 0
}

/**
 * 前日からホールドが増えた投手。
 *
 * 個人成績は積み上げの数字なので、2日ぶんを引けばその試合で付いたぶんが出る。
 * 前の日に居なかった投手は0から数える（昇格した直後など）。
 *
 * 試合の無い日は差が出ないので、呼んでも空が返る。
 */
export function holdPitchers(before: PitcherRow[], after: PitcherRow[]): string[] {
  const was = new Map(before.map((r) => [squash(r.player_name), holdsOf(r)]))
  const out: string[] = []

  for (const row of after) {
    const gained = holdsOf(row) - (was.get(squash(row.player_name)) ?? 0)
    if (gained > 0) out.push(row.player_name.trim())
  }
  return out
}

/**
 * 1試合ぶんをまとめる。
 *
 * 勝利投手・セーブはマリーンズが勝った試合だけ出す。負けた試合の勝利投手は
 * 相手の投手なので、名鑑から引けず、出しても意味がない。
 */
export function buildContributors(input: {
  rosterHtml: string | null
  homeRuns: BoxHomeRun[]
  winPitcher: string
  savePitcher: string
  /** マリーンズが勝ったか。引き分けは false */
  isWin: boolean
  /** 前日の個人投手成績 */
  pitchingBefore: PitcherRow[]
  /** その日の個人投手成績 */
  pitchingAfter: PitcherRow[]
}): Contributors {
  const roster = input.rosterHtml ? parseRoster(input.rosterHtml) : []

  return {
    home_runs: marinesHomeRuns(input.homeRuns, roster),
    win: input.isWin ? who(roster, input.winPitcher) : null,
    save: input.isWin ? who(roster, input.savePitcher) : null,
    holds: holdPitchers(input.pitchingBefore, input.pitchingAfter)
      .map((name) => who(roster, name))
      .filter((w): w is Who => w !== null),
  }
}

/** 何も入っていないか。空なら画面に行を足さない */
export function hasContributors(c: Contributors | null | undefined): boolean {
  if (!c) return false
  return c.home_runs.length > 0 || c.holds.length > 0 || Boolean(c.win) || Boolean(c.save)
}

/**
 * 画面に出す1行。
 *
 *   `#51 山口 36号 37号 ・ W #14 小島 ・ S #15 横山 ・ H #56 中森`
 *
 * 同じ選手が2本打った日は1つにまとめる。並べると同じ名前が2回出て読みにくい。
 * 背番号の書き方は積立の見出しとそろえる（lib/saving-label.ts）。
 */
export function contributorsLine(c: Contributors | null | undefined): string {
  if (!hasContributors(c) || !c) return ''
  const parts: string[] = []

  // 打った順のまま、同じ選手をまとめる
  const byPlayer: { who: Who; numbers: string[] }[] = []
  for (const hit of c.home_runs) {
    const found = byPlayer.find((p) => p.who.number === hit.number && p.who.name === hit.name)
    const target = found ?? { who: { number: hit.number, name: hit.name }, numbers: [] }
    if (!found) byPlayer.push(target)
    if (hit.no) target.numbers.push(hit.no)
  }
  for (const player of byPlayer) {
    parts.push([label(player.who), ...player.numbers].join(' '))
  }

  if (c.win) parts.push(`W ${label(c.win)}`)
  if (c.save) parts.push(`S ${label(c.save)}`)
  if (c.holds.length > 0) parts.push(`H ${c.holds.map(label).join(' ')}`)

  return parts.join(' ・ ')
}

/** `#51 山口`。背番号が引けなければ名前だけ */
function label(w: Who): string {
  return w.number ? `#${w.number} ${w.name}` : w.name
}
