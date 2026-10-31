import { NextResponse, type NextRequest } from 'next/server'

import { STATE_COOKIE, siteOrigin } from '@/app/api/google/todo/connect/route'
import { connectWithCode } from '@/lib/google-tasks'
import { getSessionUser } from '@/lib/queries'
import { createClient } from '@/lib/supabase/server'
import { GTODO_TAG } from '@/lib/tasks'

/**
 * Google から戻ってくるところ（0100）。
 *
 * state を確かめ、code を token に替えて預かる。ついでに「GoogleToDo」の
 * タグが無ければ足す。つないだのに付ける印が無い、を避ける。
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function GET(request: NextRequest) {
  const origin = siteOrigin(request)
  const back = (q: string) => {
    const res = NextResponse.redirect(`${origin}/tasks/google?${q}`)
    res.cookies.set(STATE_COOKIE, '', { path: '/', maxAge: 0 })
    return res
  }

  const user = await getSessionUser()
  if (!user) return NextResponse.redirect(`${origin}/login`)

  const { searchParams } = new URL(request.url)
  const oauthError = searchParams.get('error')
  if (oauthError) return back(`error=${encodeURIComponent(oauthError === 'access_denied' ? 'cancelled' : oauthError)}`)

  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const expected = request.cookies.get(STATE_COOKIE)?.value
  if (!code || !state || !expected || state !== expected) return back('error=state')

  const r = await connectWithCode(user.id, code, `${origin}/api/google/todo/callback`)
  if (!r.ok) return back(`error=${encodeURIComponent(r.reason)}`)

  const supabase = await createClient()
  await supabase
    .from('task_tags')
    .upsert({ user_id: user.id, name: GTODO_TAG, sort_order: 99 }, { onConflict: 'user_id,name', ignoreDuplicates: true })

  return back('connected=1')
}
