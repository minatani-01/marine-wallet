import { randomBytes } from 'node:crypto'

import { NextResponse, type NextRequest } from 'next/server'

import { authorizeUrl } from '@/lib/google-tasks'
import { getSessionUser } from '@/lib/queries'

/**
 * Google ToDo とつなぐ入口（0100）。
 *
 * state を乱数で作ってクッキーに置き、Google の認可画面へ飛ばす。戻って
 * きたときに同じ値かを見る。他人の code を掴まされない（CSRF）ため。
 */
export const dynamic = 'force-dynamic'

/** 転送元のホストで組む。Vercel では request.url のホストが内部のものになることがある */
export function siteOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host')
  if (process.env.NODE_ENV !== 'development' && forwardedHost) return `https://${forwardedHost}`
  return new URL(request.url).origin
}

export const STATE_COOKIE = 'mw-gtodo-state'

export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  const origin = siteOrigin(request)
  if (!user) return NextResponse.redirect(`${origin}/login`)

  const state = randomBytes(16).toString('hex')
  const url = authorizeUrl(`${origin}/api/google/todo/callback`, state)
  if (!url) return NextResponse.redirect(`${origin}/tasks/google?error=${encodeURIComponent('not_configured')}`)

  const res = NextResponse.redirect(url)
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
  return res
}
