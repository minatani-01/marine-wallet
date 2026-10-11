/**
 * 借りている画像を取り込むときの決め事（0063）。
 *
 * サーバーが外のURLを取りに行くので、行き先を絞る。ここを開けておくと、
 * 品のURL欄に社内向けのアドレスを書くだけで、サーバーに代わりに叩かせる
 * ことができてしまう。移行ぶんは Drive にしか無いので、Drive だけ通す。
 *
 * 純関数にしてある。通す・通さないの線をテストで固定できる。
 */

/** 取りに行ってよい相手。Drive と、その画像配信 */
const ALLOWED_HOSTS = ['drive.google.com', 'drive.usercontent.google.com']
const ALLOWED_SUFFIX = '.googleusercontent.com'

/** 取り込める画像か。駄目なら理由を返す */
export function rejectSourceReason(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'URLとして読めません'
  }

  if (parsed.protocol !== 'https:') return 'https のURLだけ取り込めます'

  const host = parsed.hostname.toLowerCase()
  const allowed = ALLOWED_HOSTS.includes(host) || host.endsWith(ALLOWED_SUFFIX)
  if (!allowed) return 'Google Drive の画像だけ取り込めます'

  return null
}

/** 拡張子。取れた形式に合わせる。分からなければ jpg にしておく */
function extensionOf(contentType: string): string {
  const type = contentType.split(';')[0].trim().toLowerCase()
  if (type === 'image/png') return 'png'
  if (type === 'image/webp') return 'webp'
  if (type === 'image/gif') return 'gif'
  return 'jpg'
}

/**
 * 上げ先のパス。
 *
 * 先頭フォルダを userId にするのは Storage の RLS（0063）に合わせるため。
 * 品のIDを挟んでおくと、同じ品を2回取り込んでも増えない（上書きになる）。
 */
export function adoptablePath(userId: string, itemId: string, contentType: string): string {
  return `${userId}/adopted-${itemId}.${extensionOf(contentType)}`
}
