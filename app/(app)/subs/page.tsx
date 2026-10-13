import { redirect } from 'next/navigation'

import SubsClient from '@/components/subs/SubsClient'
import { jstDate } from '@/lib/jst'
import { getProfile, getSessionUser, getSubscriptions } from '@/lib/queries'

/**
 * サブスクの管理（0065）。
 *
 * master だけの画面。入口はマイページにしか出していないが、URL を直に
 * 開かれることはあるので、ここでも見る。出さないことと入れないことは別である。
 *
 * 今日の日付は日本時間に直してから渡す。ここは UTC で動いているので、
 * そのまま渡すと 0時〜9時のあいだ「次の支払い」が1日ずれる。
 */
export default async function SubsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const profile = await getProfile(user.id)
  if (!profile?.is_master) redirect('/')

  const subs = await getSubscriptions(user.id)

  return <SubsClient userId={user.id} subs={subs} today={jstDate(new Date())} />
}
