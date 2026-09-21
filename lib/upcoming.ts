import { MARINES_TEAM_LABEL } from '@/lib/npb/fetch'
import type { ScheduledGame } from '@/types'

/**
 * これからの試合の見せ方。
 *
 * DB も時計も触らない純関数にしてある。日程ページの表記をそのまま持って
 * いるので、こちらで相手・ホーム/ビジター・中止かどうかに読み替える。
 */

export type Upcoming = {
  date: string
  /** マリーンズから見た相手 */
  opponent: string
  /** 本拠地での試合かどうか */
  isHome: boolean
  place: string
  /** '18:00' など。中止のときは空にする（時刻に意味が無くなるため） */
  startTime: string
  cancelled: boolean
  /** 中止の理由など。画面には短く出す */
  note: string
}

/** 記録一覧に混ぜるときの並び。中止も日付の位置に置く */
export type RecordRow<T> =
  | { kind: 'entry'; date: string; entry: T }
  | { kind: 'cancelled'; date: string; game: Upcoming }

/** 中止のときに残しておきたい言葉。長い備考はそのまま出すと崩れる */
function shortNote(note: string): string {
  const hit = ['雨天中止', 'ノーゲーム', '中止'].find((word) => note.includes(word))
  return hit ?? ''
}

/**
 * これからの試合を、画面に出す形にする。
 *
 * マリーンズの試合だけを見る。中止も残す。「中止になった」ことは
 * 予定と同じくらい知りたい情報で、消してしまうと分からなくなる。
 */
export function upcomingOf(rows: ScheduledGame[], limit = 5): Upcoming[] {
  return rows
    .filter((row) => row.home_team === MARINES_TEAM_LABEL || row.away_team === MARINES_TEAM_LABEL)
    .slice(0, limit)
    .map((row) => {
      const isHome = row.home_team === MARINES_TEAM_LABEL
      const cancelled = row.status === 'cancelled'
      return {
        date: row.game_date,
        opponent: isHome ? row.away_team : row.home_team,
        isHome,
        place: row.place,
        startTime: cancelled ? '' : row.start_time,
        cancelled,
        note: cancelled ? shortNote(row.note) || '中止' : '',
      }
    })
}

/** その月に中止になった試合。新しい順 */
export function cancelledOf(rows: ScheduledGame[], month: string): Upcoming[] {
  return upcomingOf(
    rows.filter((row) => row.status === 'cancelled' && row.game_date.startsWith(month)),
    Number.MAX_SAFE_INTEGER
  ).sort((a, b) => b.date.localeCompare(a.date))
}

/**
 * 貯金の記録と、中止になった試合を日付順に混ぜる。
 *
 * 中止の日は貯金が入らない。記録だけを並べると、その日は何も無かったのか
 * 入れ忘れたのかが分からない。中止だったと分かれば、探さずに済む。
 *
 * 同じ日に両方あるときは記録を先に置く。金額のほうが主で、中止は注記に近い。
 */
export function mergeCancelled<T extends { entry_date: string }>(
  entries: T[],
  cancelled: Upcoming[]
): RecordRow<T>[] {
  const rows: RecordRow<T>[] = [
    ...entries.map((entry) => ({ kind: 'entry' as const, date: entry.entry_date, entry })),
    ...cancelled.map((game) => ({ kind: 'cancelled' as const, date: game.date, game })),
  ]
  return rows.sort(
    (a, b) => b.date.localeCompare(a.date) || (a.kind === 'entry' ? -1 : 1)
  )
}
