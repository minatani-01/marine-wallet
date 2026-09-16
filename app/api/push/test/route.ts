import { NextResponse } from 'next/server'

import { getSessionUser } from '@/lib/queries'
import { pushConfigured, sendPushToUsers } from '@/lib/push'

/**
 * 自分あてのテスト送信。
 *
 * 通知が届くかどうかは端末とブラウザの設定に左右されるので、
 * 実際に1通送って確かめられるようにしておく。
 * 送り先は自分の購読だけ。他人へは送れない。
 */
export const dynamic = 'force-dynamic'

export async function POST() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  if (!pushConfigured()) {
    return NextResponse.json(
      { error: '通知の鍵が設定されていません' },
      { status: 503 }
    )
  }

  const result = await sendPushToUsers([user.id], {
    // アプリ名にしない。iOS は通知に「from Marine Wallet」を自分で足すので、
    // タイトルもアプリ名だと同じ言葉が2行続いて読みにくくなる
    title: '通知のテスト',
    body: '通知のテストです。これが見えていれば設定は完了しています。',
    // 本人が今まさに押したものなので、受け取る種類の設定では止めない
    category: 'always',
    url: '/me#notifications',
    tag: 'test',
  })

  if (result.sent === 0) {
    return NextResponse.json(
      { error: 'この端末の購読が見つかりませんでした', ...result },
      { status: 404 }
    )
  }
  return NextResponse.json({ ok: true, ...result })
}
