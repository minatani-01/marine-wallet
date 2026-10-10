import type { SupabaseClient } from '@supabase/supabase-js'

import { FAVORITE_BUCKET, FAVORITE_MAX_EDGE } from '@/lib/constants'
import { toReceiptJpeg } from '@/lib/receipt'
import type { FavoriteItem } from '@/types'

/**
 * お気に入りの品（0063）。
 *
 * もとは Google Apps Script の「RE:SELECT」で、スプレッドシートを正本に
 * していた。並び順と絞り込みの決め方はそちらに合わせてある。別の形にすると、
 * 移したあとで並びが変わって探せなくなる。
 *
 * ここは純関数にしてある。DB も時計も触らないので、テストで確かめられる。
 */

/** ステータス。これで全部とはしない。書いたものがそのまま入る */
export const FAVORITE_STATUSES = ['リピート', '欲しい'] as const

/** ジャンルを書かなかったときの入れ先 */
export const DEFAULT_GENRE = 'その他'

/** 絞り込みの「すべて」。ジャンル名と混ざらない値にする */
export const ALL_GENRES = '__all__'

/**
 * 並べ方。表示順 → ジャンル → 名前。
 *
 * 表示順だけだと、同じ番号のものが並んだときに毎回違う順で出る。
 * 日本語の並びは localeCompare に任せる。
 */
export function sortItems(items: FavoriteItem[]): FavoriteItem[] {
  return [...items].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
    const genre = a.genre.localeCompare(b.genre, 'ja')
    if (genre !== 0) return genre
    return a.name.localeCompare(b.name, 'ja')
  })
}

/**
 * 出ているジャンルを、品の多い順に並べて返す。
 *
 * 決め打ちの一覧を持たない。使っているジャンルだけを出すほうが、
 * 空の絞り込みを押してしまうことがない。
 */
export function genresOf(items: FavoriteItem[]): string[] {
  const count = new Map<string, number>()
  for (const item of items) {
    count.set(item.genre, (count.get(item.genre) ?? 0) + 1)
  }

  return [...count.entries()]
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0], 'ja')))
    .map(([genre]) => genre)
}

/** 選んだジャンルだけに絞る。ALL_GENRES ならそのまま */
export function filterByGenre(items: FavoriteItem[], genre: string): FavoriteItem[] {
  return genre === ALL_GENRES ? items : items.filter((item) => item.genre === genre)
}

/**
 * 出す画像のURL。
 *
 * 上げたものを先に見る。移行ぶんは Drive から借りているURLしか持たない。
 * どちらも無ければ null を返し、画面は枠だけを出す。
 *
 * @param signed image_path に対して発行した署名付きURL
 */
export function imageSrc(item: FavoriteItem, signed: Map<string, string>): string | null {
  if (item.image_path) return signed.get(item.image_path) ?? null
  return item.image_url || null
}

/** 画像がまだ Drive 任せのものか。入れ直しをすすめる印に使う */
export function isBorrowedImage(item: FavoriteItem): boolean {
  return !item.image_path && item.image_url.length > 0
}

/** 「¥6,480」。分からないものは空にする（0円と区別する） */
export function priceText(price: number | null): string {
  return typeof price === 'number' ? `¥${price.toLocaleString()}` : ''
}

/**
 * 入力を確かめる。駄目なら理由を返す。
 *
 * URL は http/https だけを通す。javascript: を書かれたものをそのまま
 * リンクにすると、押した人の画面で動いてしまう。
 */
export function rejectReason(input: { name: string; price: string; shop_url: string }): string | null {
  if (!input.name.trim()) return '商品名を入れてください'

  if (input.price.trim()) {
    const price = Number(input.price)
    if (!Number.isFinite(price) || price < 0) return '価格を正しく入れてください'
  }

  const url = input.shop_url.trim()
  if (url && !/^https?:\/\//i.test(url)) return '購入URLは http:// か https:// から入れてください'

  return null
}

/** 入力した価格を保存する形にする。空なら null（0円と区別する） */
export function parsePrice(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const price = Number(trimmed)
  return Number.isFinite(price) && price >= 0 ? Math.round(price) : null
}

/**
 * 画像を上げて、保存先のパスを返す。
 *
 * 変換は領収書と同じ仕組みを使う（lib/receipt.ts）。長辺だけを縮め、
 * 縦横の比は変えない。一覧に小さく並べるだけなので領収書より小さい。
 *
 * 先頭フォルダを userId にするのは Storage の RLS（0063）に合わせるため。
 */
export async function uploadFavoriteImage(
  supabase: SupabaseClient,
  userId: string,
  file: File
): Promise<string> {
  const blob = await toReceiptJpeg(file, FAVORITE_MAX_EDGE)
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const { error } = await supabase.storage
    .from(FAVORITE_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new Error('画像のアップロードに失敗しました')
  return path
}

/**
 * 参照されなくなった画像を消す。
 *
 * 失敗しても投げない。記録から外れていれば画面の表示は正しく、
 * 残るのは無料枠の中の数百KBだけである。
 */
export async function removeFavoriteImage(supabase: SupabaseClient, path: string) {
  if (!path) return
  await supabase.storage.from(FAVORITE_BUCKET).remove([path])
}
