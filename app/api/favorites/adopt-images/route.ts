import { NextResponse } from 'next/server'

import { FAVORITE_BUCKET } from '@/lib/constants'
import { getSessionUser } from '@/lib/queries'
import { createClient } from '@/lib/supabase/server'
import { adoptablePath, rejectSourceReason } from '@/lib/favorites-adopt'
import type { FavoriteItem } from '@/types'

/**
 * 借りている画像を、アプリの中へ移す（0063）。
 *
 * 移行ぶんは Google Drive のURLしか持たない。Drive 側を片付けたり共有を
 * 変えたりすると画像が消えるので、1回押したらこちらのバケットへ写し取る。
 *
 * ブラウザから直に取りに行けない。Drive は画像の配信に CORS の許可を
 * 付けないので、fetch すると読めず、img から canvas に移しても汚染されて
 * 取り出せない。サーバーで取ってきて、そのまま上げる。
 *
 * 上げ先はログインしている本人のフォルダ。ここではその人のセッションで
 * Storage を触るので、他人の場所へは RLS が通さない（0063）。
 */
export const dynamic = 'force-dynamic'

/** 取りに行く時間の上限。遅い1枚で画面を待たせない */
const FETCH_TIMEOUT_MS = 15_000

/** 1枚の上限。商品の写真なので、これを超えるものは何かおかしい */
const MAX_BYTES = 8 * 1024 * 1024

export async function POST() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = await createClient()

  // 借りているものだけ。自分の行しか返らない（RLS）
  const { data, error } = await supabase
    .from('favorite_items')
    .select('*')
    .eq('user_id', user.id)
    .eq('image_path', '')
    .neq('image_url', '')

  if (error) return NextResponse.json({ error: '読み込めませんでした' }, { status: 500 })

  const targets = (data ?? []) as FavoriteItem[]
  if (targets.length === 0) return NextResponse.json({ moved: 0, failed: 0 })

  let moved = 0
  const failures: string[] = []

  for (const item of targets) {
    const reason = rejectSourceReason(item.image_url)
    if (reason) {
      failures.push(`${item.name}: ${reason}`)
      continue
    }

    let blob: Blob
    try {
      const res = await fetch(item.image_url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
      })
      if (!res.ok) {
        failures.push(`${item.name}: 取得できませんでした（${res.status}）`)
        continue
      }
      const type = res.headers.get('content-type') ?? ''
      if (!type.startsWith('image/')) {
        // 共有されていない Drive のURLは、画像ではなくログイン画面を返す
        failures.push(`${item.name}: 画像が返りませんでした`)
        continue
      }
      blob = await res.blob()
      if (blob.size === 0 || blob.size > MAX_BYTES) {
        failures.push(`${item.name}: 大きさが扱える範囲を超えています`)
        continue
      }
    } catch {
      failures.push(`${item.name}: 取得できませんでした`)
      continue
    }

    const path = adoptablePath(user.id, item.id, blob.type)
    const { error: uploadError } = await supabase.storage
      .from(FAVORITE_BUCKET)
      .upload(path, blob, { contentType: blob.type, upsert: true })

    if (uploadError) {
      failures.push(`${item.name}: 置けませんでした`)
      continue
    }

    // 借りていたURLは外す。両方あると、どちらを見ているのか分からなくなる
    const { error: updateError } = await supabase
      .from('favorite_items')
      .update({ image_path: path, image_url: '' })
      .eq('id', item.id)

    if (updateError) {
      // 上げたものは消しておく。参照されないまま残すと無駄になる
      await supabase.storage.from(FAVORITE_BUCKET).remove([path])
      failures.push(`${item.name}: 記録を更新できませんでした`)
      continue
    }

    moved += 1
  }

  return NextResponse.json({
    moved,
    failed: failures.length,
    // 1枚も移せなかったときだけ、理由を画面に出す
    error: moved === 0 && failures.length > 0 ? failures[0] : undefined,
  })
}
