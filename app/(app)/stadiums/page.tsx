import { redirect } from 'next/navigation'
import StampClient from '@/components/stadiums/StampClient'
import { getCircleMembers, getRecentGames, getSessionUser, getStadiumVisits } from '@/lib/queries'

export default async function StadiumsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // 試合は全員共通。行ったかどうかだけが人ごと（0038）
  const [visits, games, members] = await Promise.all([
    getStadiumVisits(user.id),
    getRecentGames(400),
    // 同行者の名前
    getCircleMembers(),
  ])

  return <StampClient visits={visits} games={games} members={members} />
}
