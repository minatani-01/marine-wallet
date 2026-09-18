import { redirect } from 'next/navigation'
import SavingsClient from '@/components/savings/SavingsClient'
import {
  getMonthlySavings,
  getProfile,
  getRecentGames,
  getSavingEntries,
  getSavingCustomPresets,
  getSavingRules,
  getSessionUser,
  getSharedGoals,
  getStadiumVisits,
} from '@/lib/queries'

export default async function SavingsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const [entries, monthlySavings, rules, presets, goals, profile, games, visits] =
    await Promise.all([
      getSavingEntries(user.id),
      getMonthlySavings(user.id),
      getSavingRules(),
      getSavingCustomPresets(),
      getSharedGoals(),
      getProfile(user.id),
      // 共通の試合。自分がまだ積み立てていないものを拾うために使う
      getRecentGames(400),
      // 現地観戦の記録。試合ごとのボタンの状態に使う
      getStadiumVisits(user.id),
    ])

  return (
    <SavingsClient
      userId={user.id}
      entries={entries}
      monthlySavings={monthlySavings}
      rules={rules}
      presets={presets}
      goals={goals}
      isMaster={profile?.is_master ?? false}
      games={games}
      visits={visits}
    />
  )
}
