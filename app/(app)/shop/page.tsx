import { redirect } from 'next/navigation'

import ShopClient from '@/components/shop/ShopClient'
import { getFavoriteItems, getSessionUser } from '@/lib/queries'

/**
 * RE:SELECT（また買うもの・欲しいもの）。
 *
 * もとは Google Apps Script のアプリで、スプレッドシートを正本にしていた。
 * 買うものは人それぞれで、二人で足し合わせる数字でもないので、
 * 共有せず自分の行だけを出す（0063）。
 */
export default async function ShopPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const items = await getFavoriteItems(user.id)

  return <ShopClient userId={user.id} items={items} />
}
