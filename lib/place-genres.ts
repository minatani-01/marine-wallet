import type { PlaceGenre } from '@/types'

/**
 * ジャンルの並び替え。
 *
 * DB も通信もしない純関数にしてある。並びは sort_order で決まるが、
 * 隣と入れ替えるだけにすると、同じ値が並んでいるとき（既定値のまま
 * 足したとき）に何も起きない。動かしたあとに全体を振り直す。
 *
 * 上下のボタンで1つずつ動かす形にしている。指でつまんで動かす形は
 * 気持ちよいが、スマートフォンでは画面を縦に送る動きとぶつかり、
 * 掴んだつもりが画面ごと動く。
 */

/** 振り直したあとの並び順。書き戻すのはここに入ったものだけ */
export type GenreOrder = { id: string; sort_order: number }

/** 振り直しの刻み。あとから間に差し込めるよう、1ずつにはしない */
const STEP = 10

/**
 * 1つ上（-1）または1つ下（1）へ動かす。
 *
 * 端にあるもの、知らない id のときは空を返す。呼ぶ側で押せなくしてあるが、
 * ここでも何も起きないようにしておく。
 */
export function reorderGenres(
  genres: PlaceGenre[],
  id: string,
  direction: -1 | 1
): { rows: PlaceGenre[]; changed: GenreOrder[] } {
  const from = genres.findIndex((g) => g.id === id)
  const to = from + direction

  if (from < 0 || to < 0 || to >= genres.length) return { rows: genres, changed: [] }

  const moved = [...genres]
  const [picked] = moved.splice(from, 1)
  moved.splice(to, 0, picked)

  const rows = moved.map((genre, index) => ({ ...genre, sort_order: (index + 1) * STEP }))
  const changed = rows
    .filter((genre) => genre.sort_order !== genres.find((g) => g.id === genre.id)?.sort_order)
    .map((genre) => ({ id: genre.id, sort_order: genre.sort_order }))

  return { rows, changed }
}
