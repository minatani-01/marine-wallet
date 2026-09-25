import { NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUsers } from '@/lib/push'
import { dueBoundary, fastEnd, fastingMinutes, jstMinutes, spanText } from '@/lib/autophagy'
import type { AutophagySettings } from '@/types'

/**
 * オートファジーの境目を知らせる（0053）。
 *
 * 食べてよい時間の始まりと終わりに1回ずつ送る。時刻は人が決めるので、
 * 1日1回の Cron では間に合わない。1分おきに呼ばれる前提で書いてあり、
 * 呼ぶ側は Supabase の pg_cron（pg_net で叩く）を想定している。
 * Vercel の Cron は Hobby だと1日1回までで、2枠とも既に使っている。
 *
 * 何度呼ばれても、同じ境目では1回しか送らない。境目から数分のあいだは
 * 何度も呼ばれるので、last_notified_at と last_notified_kind で覚えておく。
 *
 * 送るものが無ければ Push も DB の書き込みもしない。1日1440回呼ばれても、
 * 実際に動くのは1人あたり2回だけになる。
 */
export const dynamic = 'force-dynamic'

/** 境目からこの分数までを「いま」とみなす。呼び出しが1回飛んでも取りこぼさない */
const WINDOW_MINUTES = 5

/** 同じ境目で二度鳴らさないための間隔。次の境目までは必ず空く */
const QUIET_MINUTES = 60

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

type Row = Pick<
  AutophagySettings,
  | 'user_id'
  | 'fast_start'
  | 'fast_hours'
  | 'notify_eat'
  | 'notify_fast'
  | 'last_notified_at'
  | 'last_notified_kind'
>

/** 判定に使う形。時刻は 'HH:MM:SS' で返るが、先頭一致で読むので渡すだけでよい */
function planOf(row: Row) {
  return { fast_start: row.fast_start, fast_hours: row.fast_hours }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    // 設定漏れと不正なアクセスを区別しない。存在を教えないため
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let supabase: ReturnType<typeof createAdminClient>
  try {
    supabase = createAdminClient()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }

  const { data, error } = await supabase
    .from('autophagy_settings')
    .select(
      'user_id, fast_start, fast_hours, notify_eat, notify_fast, last_notified_at, last_notified_kind'
    )
    .eq('enabled', true)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const now = new Date()
  const minutes = jstMinutes(now)
  const rows = (data ?? []) as Row[]

  // 何件が境目に当たり、何件に送ったか。呼ぶ側からは通知そのものが見えないので、
  // 届かないときにどこで止まっているかを切り分けられるようにしておく
  let due = 0
  let sent = 0
  let skipped = 0

  for (const row of rows) {
    const plan = planOf(row)
    const kind = dueBoundary(plan, minutes, WINDOW_MINUTES)
    if (!kind) continue
    due += 1

    // その境目を切っているなら送らない
    if (kind === 'eat' && !row.notify_eat) continue
    if (kind === 'fast' && !row.notify_fast) continue

    // 同じ境目で既に送っていないか。時計を戻されても困らないよう、
    // 種類と時刻の両方を見る
    if (row.last_notified_kind === kind && row.last_notified_at) {
      const since = (now.getTime() - new Date(row.last_notified_at).getTime()) / 60000
      if (since < QUIET_MINUTES) {
        skipped += 1
        continue
      }
    }

    const startAt = row.fast_start.slice(0, 5)
    const endAt = fastEnd(plan) ?? ''
    const length = fastingMinutes(plan)

    const message =
      kind === 'eat'
        ? {
            title: '食べてOKの時間です',
            body: `次に食べられなくなるのは ${startAt} から。`,
            category: 'always' as const,
            url: '/body',
            tag: 'autophagy-eat',
          }
        : {
            title: '食べない時間になりました',
            body: `${endAt} まで${length === null ? '' : spanText(length)}。`,
            category: 'always' as const,
            url: '/body',
            tag: 'autophagy-fast',
          }

    const result = await sendPushToUsers([row.user_id], message)
    sent += result.sent

    await supabase
      .from('autophagy_settings')
      .update({ last_notified_at: now.toISOString(), last_notified_kind: kind })
      .eq('user_id', row.user_id)
  }

  return NextResponse.json({ ok: true, at: minutes, checked: rows.length, due, sent, skipped })
}
