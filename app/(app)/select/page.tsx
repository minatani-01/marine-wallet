import { redirect } from 'next/navigation'

import SelectClient from '@/components/select/SelectClient'
import { getFavoriteItems, getSessionUser } from '@/lib/queries'

/**
 * RE:SELECT（お気に入りの品）。
 *
 * もとは Google Apps Script のアプリで、スプレッドシートを正本にしていた。
 * 買うものは人それぞれで、二人で足し合わせる数字でもないので、
 * 共有せず自分の行だけを出す（0063）。
 */
export default async function SelectPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const items = await getFavoriteItems(user.id)

  return <SelectClient userId={user.id} items={items} />
}
