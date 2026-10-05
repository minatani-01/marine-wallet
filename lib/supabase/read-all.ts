/**
 * 行数の多い表を、分けて読む。
 *
 * PostgREST は1回の問い合わせで返す行数に上限がある（Supabase の既定は1000行）。
 * 上限に当たっても切り詰めたことは知らせてくれず、ふつうに成功して返る。
 * そのため「最近のぶんが丸ごと無いのに、エラーは1つも出ない」という形で出る。
 *
 * 実際それで、シーズン記録のキャッチアップが途中から止まっていた。個人成績の
 * スナップショットが1945行あり、読めていたのは古いほうの1000行だけだった。
 * 9/24 以降に節目を越えた選手は、毎朝の取り込みから見えていなかった。
 *
 * 使うときは必ず並び順を決めること。順番が決まっていないと、2回目以降の
 * 読み取りで同じ行が出たり抜けたりする。
 */

/** 1回で読む行数。上限より大きくても、返ってきたぶんだけ進めるので問題ない */
const PAGE_SIZE = 1000

/** 念のための打ち切り。ここまで来るなら呼び方のほうを疑う */
const MAX_PAGES = 100

type Page<T> = PromiseLike<{
  data: T[] | null
  error: { message: string } | null
}>

/**
 * 最後まで読む。
 *
 * @param page 範囲を受け取って1ページ分を返す関数。`.range(from, to)` を付けたもの
 *
 * ```ts
 * const rows = await readAll<Row>((from, to) =>
 *   supabase.from('npb_player_stat_snapshots')
 *     .select('as_of, kind, player_name, stats')
 *     .order('as_of')
 *     .order('player_name')
 *     .range(from, to)
 * )
 * ```
 */
export async function readAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const out: T[] = []

  for (let i = 0; i < MAX_PAGES; i += 1) {
    const { data, error } = await page(out.length, out.length + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)

    const rows = data ?? []
    // 空が返るまで読む。上限が PAGE_SIZE より小さくても取りこぼさない
    if (rows.length === 0) return out
    out.push(...rows)
  }

  throw new Error(`読み取りが ${MAX_PAGES} ページを超えました`)
}
