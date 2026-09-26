import type { SupabaseClient } from '@supabase/supabase-js'

import { RECEIPT_BUCKET, RECEIPT_MAX_EDGE } from '@/lib/constants'

/**
 * 領収書・決済画面の写真（0055）。
 *
 * アイコン（lib/avatar.ts）と違って、正方形に切ってはいけない。
 * レシートは縦に長く、切ると合計金額が落ちる。縦横の比を保ったまま
 * 長辺だけを縮める。
 *
 * 縮めるのは、あとで読み返せる大きさを残しつつ、無料の範囲（1GB）に
 * 収め続けるため。長辺1400pxなら、スマホで拡大すれば紙のレシートの
 * 品目まで読める。
 */

/** 読み込みを試す上限。これを超えるものは変換前に断る（デコードで固まらせないため） */
export const MAX_RECEIPT_SOURCE_BYTES = 20 * 1024 * 1024

/**
 * 長辺を max に収める大きさを出す。縦横の比は変えない。
 *
 * もとが小さいときは引き伸ばさない。粗い画像を大きくしても読めるように
 * ならず、容量だけ増える。
 */
export function fitWithin(
  width: number,
  height: number,
  max: number
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= 0) return { width: 0, height: 0 }
  if (longest <= max) return { width: Math.round(width), height: Math.round(height) }

  const scale = max / longest
  return {
    // 1px を下回らせない。0 は canvas が受け取れない
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** 受け取ったファイルが扱えるものか確かめる。駄目なら理由を返す */
export function rejectReason(file: File): string | null {
  if (!file.type.startsWith('image/')) return '画像を選んでください'
  if (file.size > MAX_RECEIPT_SOURCE_BYTES) return '画像が大きすぎます（20MBまで）'
  return null
}

/**
 * 選んだ画像を、長辺 RECEIPT_MAX_EDGE の JPEG に変換する。
 *
 * Image 要素を経由するのは、canvas に描くときに EXIF の向きが反映されるため
 * （createImageBitmap は環境によって回転が落ちる）。横向きに撮ったレシートが
 * 寝たまま保存されるのを防ぐ。
 */
export async function toReceiptJpeg(file: File, max = RECEIPT_MAX_EDGE): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('画像を読み込めませんでした'))
      el.src = url
    })

    const size = fitWithin(image.naturalWidth, image.naturalHeight, max)
    if (size.width === 0 || size.height === 0) throw new Error('画像を読み込めませんでした')

    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('画像を変換できませんでした')

    ctx.drawImage(image, 0, 0, size.width, size.height)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('画像を変換できませんでした'))),
        'image/jpeg',
        // 文字を読むための写真なので、アイコンより少しだけ良くする
        0.82
      )
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * 変換した画像をアップロードし、保存先のパスを返す。
 *
 * 先頭フォルダを userId にするのは Storage の RLS（0055）に合わせるため。
 * 名前に時刻を入れるのは、同じ名前で上書きすると端末やCDNに残った
 * 古い画像がそのまま出ることがあるため。
 */
export async function uploadReceipt(
  supabase: SupabaseClient,
  userId: string,
  file: File
): Promise<string> {
  const blob = await toReceiptJpeg(file)
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const { error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new Error('写真のアップロードに失敗しました')
  return path
}

/**
 * 参照されなくなったファイルを消す。
 *
 * 失敗しても投げない。記録から外れていれば画面の表示は正しく、
 * 残るのは無料枠の中の数百KBだけである。
 */
export async function removeReceiptFile(supabase: SupabaseClient, path: string | null) {
  if (!path) return
  await supabase.storage.from(RECEIPT_BUCKET).remove([path])
}
