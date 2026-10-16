/**
 * 特製ドリンクのレシピ（0069）。
 *
 * 置くのは名前と分量だけ。分量は1行1つの文字列で持つ。
 * 「プロテイン 30g」のように材料と量をまとめて書けるようにしたいので、
 * 分けない。分けると、粉・液体・個数で単位が割れて、どれにも当てはまらない
 * 書き方が出てくる。
 *
 * ここは純関数にしてある。DB も時計も触らないので、テストで確かめられる。
 */

/** 分量の行数の上限。これを超えるものは、もうレシピではなく手順書である */
export const MAX_INGREDIENTS = 20

/**
 * 分量のテキストを行に割る。
 *
 * 空行と前後の空白は落とす。書いている途中の改行や、貼り付けたときに
 * 付いてくる末尾の改行が、そのまま空の箇条書きとして出てしまう。
 */
export function ingredientLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** 入力を確かめる。駄目なら理由を返す */
export function rejectRecipeReason(input: { name: string; ingredients: string }): string | null {
  if (!input.name.trim()) return '名前を入れてください'

  const lines = ingredientLines(input.ingredients)
  if (lines.length > MAX_INGREDIENTS) {
    return `分量は${MAX_INGREDIENTS}行までにしてください`
  }

  return null
}
