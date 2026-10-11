/**
 * 手で並べ替えるときの計算（0063）。
 *
 * 画面はジャンルで絞れる。絞っているあいだに並べ替えたとき、見えていない品を
 * 巻き込んで動かさないようにする。見えている品が占めていた場所はそのままにし、
 * その場所の中だけで入れ替える。
 *
 * 純関数にしてある。並びの決め方はここだけを読めば分かる。
 */

/** from の位置のものを to の位置へ移す。元の配列は変えない */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export type Sortable = { id: string; sort_order: number }

/**
 * 並べ替えた結果の表示順を出す。変わった行だけ返す。
 *
 * 全部に 1 から振り直す。元の番号（既定の 100 など）をそのまま使うと、
 * 同じ番号の品が並んだときに毎回違う順で出てしまう。
 *
 * @param all 全件。いま画面に出している順に並んでいること
 * @param nextVisibleIds 見えている品の、並べ替えたあとの順
 */
export function reorderedSortOrders(all: Sortable[], nextVisibleIds: string[]): Sortable[] {
  const byId = new Map(all.map((item) => [item.id, item]))
  const visible = new Set(nextVisibleIds)

  // 見えている品が占めている場所。ここへ新しい順で詰め直す
  const slots: number[] = []
  all.forEach((item, index) => {
    if (visible.has(item.id)) slots.push(index)
  })

  const next = [...all]
  slots.forEach((slot, k) => {
    const item = byId.get(nextVisibleIds[k])
    if (item) next[slot] = item
  })

  return next
    .map((item, index) => ({ id: item.id, sort_order: index + 1 }))
    .filter((row) => byId.get(row.id)?.sort_order !== row.sort_order)
}
