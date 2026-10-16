/**
 * 特製ドリンクのレシピ（0069）。
 *
 * 材料は1行1つの文字列で持つ。「プロテイン 30g」のように量まで含めて
 * 書けるようにしたいので、名前と量に分けない。分けると、粉・液体・個数で
 * 単位が割れて、どれにも当てはまらない書き方が出てくる。
 *
 * ここは純関数にしてある。DB も時計も触らないので、テストで確かめられる。
 */

/** 材料の行数の上限。これを超えるものは、もうレシピではなく手順書である */
export const MAX_INGREDIENTS = 20

/**
 * 材料のテキストを行に割る。
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
    return `材料は${MAX_INGREDIENTS}行までにしてください`
  }

  return null
}
