import { redirect } from 'next/navigation'

import BodyClient from '@/components/body/BodyClient'
import { today } from '@/lib/format'
import {
  getAutophagySettings,
  getBodyCareLogs,
  getBodyProfile,
  getBodyWeights,
  getFreeWeightLogs,
  getProfile,
  getSaunaLogs,
  getSessionUser,
  getWorkoutSessions,
} from '@/lib/queries'

/**
 * からだ（ダイエット・美容・トレーニング / RE:FORM）。
 *
 * master だけの画面。タブも master にしか出していないが、URL を直に開かれる
 * ことはあるので、ここでも見る。出さないことと入れないことは別である。
 *
 * 記録は6種類あるが、まとめて読む。画面の中でタブを移るたびに取りに行くと、
 * 移った先が一瞬空になる。件数には上限を付けてある（BODY_LOG_LIMIT）。
 */
export default async function BodyPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const profile = await getProfile(user.id)
  if (!profile?.is_master) redirect('/')

  const [settings, bodyProfile, weights, sessions, freeWeights, saunaLogs, careLogs] =
    await Promise.all([
      getAutophagySettings(user.id),
      getBodyProfile(user.id),
      getBodyWeights(user.id),
      getWorkoutSessions(user.id),
      getFreeWeightLogs(user.id),
      getSaunaLogs(user.id),
      getBodyCareLogs(user.id),
    ])

  // 最初の描画をブラウザと揃えるため、サーバーの時刻と今日を渡す
  return (
    <BodyClient
      userId={user.id}
      settings={settings}
      nowIso={new Date().toISOString()}
      today={today()}
      profile={bodyProfile}
      weights={weights}
      sessions={sessions}
      freeWeights={freeWeights}
      saunaLogs={saunaLogs}
      careLogs={careLogs}
    />
  )
}
