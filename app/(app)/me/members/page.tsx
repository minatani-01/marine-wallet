import { redirect } from 'next/navigation'
import MembersClient from '@/components/me/MembersClient'
import {
  getLinkMonthlyCompare,
  getMarineLinks,
  getMonthSavingTotal,
  getProfile,
  getSessionUser,
  getSharedGoals,
  getSplitMembers,
  getSplitOwnerId,
} from '@/lib/queries'
import { currentMonth } from '@/lib/format'

export default async function MembersPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const month = currentMonth()

  // メンバーは割り勘と同じ共有データ（0037）。
  // 支出の負担はメンバー名で書いてあるので、別々に持つと引けなくなる
  const [profile, ownerId] = await Promise.all([
    getProfile(user.id),
    getSplitOwnerId(user.id),
  ])

  const [members, links] = await Promise.all([
    getSplitMembers(ownerId, profile?.marine_id ?? null),
    getMarineLinks(user.id),
  ])
  // 月間比較は接続相手が確定してからでないと引けないので、links の後に取る
  const [compare, myMonthTotal, goals] = await Promise.all([
    getLinkMonthlyCompare(links, members, month),
    getMonthSavingTotal(user.id, month),
    getSharedGoals(),
  ])

  return (
    <MembersClient
      userId={user.id}
      ownerId={ownerId}
      marineId={profile?.marine_id ?? ''}
      isMaster={profile?.is_master ?? false}
      members={members}
      links={links}
      month={month}
      myMonthTotal={myMonthTotal}
      compare={compare}
      goals={goals}
    />
  )
}
