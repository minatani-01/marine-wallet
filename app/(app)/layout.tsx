import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import { getProfile, getSessionUser } from '@/lib/queries'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // 「からだ」のタブは master だけに出す
  const profile = await getProfile(user.id)

  return <AppShell isMaster={profile?.is_master ?? false}>{children}</AppShell>
}
