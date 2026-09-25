import { redirect } from 'next/navigation'

import BodyClient from '@/components/body/BodyClient'
import { getAutophagySettings, getProfile, getSessionUser } from '@/lib/queries'

/**
 * からだ（ダイエット・美容・トレーニング）。
 *
 * master だけの画面。タブも master にしか出していないが、URL を直に開かれる
 * ことはあるので、ここでも見る。出さないことと入れないことは別である。
 */
export default async function BodyPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const profile = await getProfile(user.id)
  if (!profile?.is_master) redirect('/')

  const settings = await getAutophagySettings(user.id)

  // 最初の描画をブラウザと揃えるため、サーバーの時刻を渡す
  return <BodyClient userId={user.id} settings={settings} nowIso={new Date().toISOString()} />
}
