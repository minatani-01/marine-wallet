/**
 * 積立1件の見出しを組み立てる（0057）。
 *
 * DB も通信もしない純関数にしてある。自動で入るぶん（npb.jp）と手で入れる
 * ぶんで、同じ関数から同じ形を出したい。別々に書くと、並べたときに
 * 「#52益田」と「#51 山口」のように書き方がずれる。
 *
 * 持つのは5つ。
 *   1 名場面     好プレー / 名球会記録 など。金額もここに紐づく
 *   2 記録名     逆転サヨナラHR / 通算250セーブ記念
 *   3 背番号・選手名
 *   4 金額
 *   5 備考
 *
 * 見出しはこのうち 2・3 から作る。背番号があれば選手の記録、無ければ
 * 球団の記録として扱う。
 */

/** 球団の記録で頭に置く名前 */
export const TEAM_NAME = 'マリーンズ'

export type Who = {
  /** 背番号。空なら球団の記録 */
  uniform_number: string
  /** 選手名。背番号だけで名前が分からないこともある */
  player_name: string
}

/** 前後の空白を落とし、全角の空白も半角にそろえる */
function tidy(value: string): string {
  return value.replace(/[\s　]+/g, ' ').trim()
}

/**
 * 「誰が」の部分。
 *
 *   背番号と名前   → `#51 山口`
 *   背番号だけ     → `#51`
 *   名前だけ       → `山口`（番号の分からない昔の選手）
 *   どちらも無い   → `マリーンズ`
 *
 * 番号と名前のあいだは空ける。詰めると「#51山口」と読みづらく、
 * 手で書くときの揺れも生む。
 */
export function whoLabel(who: Who): string {
  const number = tidy(who.uniform_number).replace(/^#/, '')
  const name = tidy(who.player_name)

  if (!number && !name) return TEAM_NAME
  if (!number) return name
  if (!name) return `#${number}`
  return `#${number} ${name}`
}

/** 背番号があれば選手の記録。無ければ球団の記録 */
export function isPlayerRecord(who: Who): boolean {
  return tidy(who.uniform_number).replace(/^#/, '').length > 0
}

/**
 * 一覧やお知らせに出す1行。
 *
 *   `#51 山口 逆転サヨナラHR`
 *   `マリーンズ 5500敗記念`
 *
 * 記録名が空のときは「誰が」だけを返す。記録名だけで誰も分からないときは
 * 球団の記録になるので、`マリーンズ ◯◯` の形になる。
 */
export function entryLabel(who: Who, recordName: string): string {
  const record = tidy(recordName)
  const head = whoLabel(who)
  return record ? `${head} ${record}` : head
}

export type Parsed = Who & { record_name: string }

/**
 * 0057 より前に、メモへ手で書いていた1行を読み分ける。
 *
 * 移行のためだけの関数だが、読み分けを間違えると「誰が」と「何を」が
 * 入れ替わって残るので、テストで確かめられるところに置いてある。
 *
 *   `#52益田 通算250セーブ記念`   → 52 / 益田 / 通算250セーブ記念
 *   `#51 山口 逆転サヨナラHR`     → 51 / 山口 / 逆転サヨナラHR
 *   `マリーンズ 5500敗記念`       → -  / -    / 5500敗記念
 *   `球場で見た`                  → -  / -    / 球場で見た
 */
export function parseLegacyNote(note: string): Parsed {
  const line = tidy(note)

  const person = /^#(\d+) ?(\S+)(?: (.*))?$/.exec(line)
  if (person) {
    return {
      uniform_number: person[1],
      player_name: person[2],
      record_name: (person[3] ?? '').trim(),
    }
  }

  const team = new RegExp(`^${TEAM_NAME} (.*)$`).exec(line)
  if (team) {
    return { uniform_number: '', player_name: '', record_name: team[1].trim() }
  }

  return { uniform_number: '', player_name: '', record_name: line }
}
