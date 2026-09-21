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
