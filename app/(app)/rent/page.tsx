import { redirect } from 'next/navigation'

import RentClient from '@/components/rent/RentClient'
import { getProfile, getSessionUser } from '@/lib/queries'

/**
 * 賃貸さがし（0075）。
 *
 * master だけの画面。入口はマイページにしか出していないが、URL を直に
 * 開かれることはあるので、ここでも見る。出さないことと入れないことは別である。
 *
 * 条件（駅と徒歩時間）は端末の中だけに置く。DB に持たせると、相手の画面にも
 * 「引っ越しを考えている」ことが見えてしまう。
 */
export default async function RentPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const profile = await getProfile(user.id)
  if (!profile?.is_master) redirect('/')

  return <RentClient />
}
