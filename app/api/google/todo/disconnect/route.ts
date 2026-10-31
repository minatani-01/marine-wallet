import { NextResponse } from 'next/server'

import { disconnect } from '@/lib/google-tasks'
import { getSessionUser } from '@/lib/queries'

/** Google ToDo とのつながりを切る（0100）。token を取り消して捨てる */
export const dynamic = 'force-dynamic'

export async function POST() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  await disconnect(user.id)
  return NextResponse.json({ ok: true })
}
