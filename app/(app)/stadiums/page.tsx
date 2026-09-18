import { redirect } from 'next/navigation'
import StampClient from '@/components/stadiums/StampClient'
import { getRecentGames, getSessionUser, getStadiumVisits } from '@/lib/queries'

export default async function StadiumsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // 試合は全員共通。行ったかどうかだけが人ごと（0038）
  const [visits, games] = await Promise.all([
    getStadiumVisits(user.id),
    getRecentGames(400),
  ])

  return <StampClient userId={user.id} visits={visits} games={games} />
}
