import { redirect } from 'next/navigation'

import RentClient from '@/components/rent/RentClient'
import { jstDate } from '@/lib/jst'
import { getProfile, getRentSearches, getRentStations, getSessionUser } from '@/lib/queries'

/**
 * 賃貸さがし（0075）。
 *
 * master だけの画面。入口はマイページにしか出していないが、URL を直に
 * 開かれることはあるので、ここでも見る。出さないことと入れないことは別である。
 *
 * いま入れている駅は端末の中（localStorage）に置く。名前を付けて残した組だけを
 * DB に持つ（0080）。どちらも自分の行しか読めないので、相手の画面には出ない。
 *
 * 今年は日本時間で切って渡す（0082）。ここは UTC で動いているので、
 * 大晦日の夜に築年数が1年ずれる。
 */
export default async function RentPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const profile = await getProfile(user.id)
  if (!profile?.is_master) redirect('/')

  const [searches, registry] = await Promise.all([getRentSearches(user.id), getRentStations()])

  return (
    <RentClient
      userId={user.id}
      searches={searches}
      registry={registry}
      thisYear={Number(jstDate(new Date()).slice(0, 4))}
    />
  )
}
