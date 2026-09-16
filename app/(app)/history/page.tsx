import { redirect } from 'next/navigation'
import HistoryClient from '@/components/history/HistoryClient'
import {
  getSavingEntries,
  getSessionUser,
  getSplitOwnerId,
  getSplitRecords,
} from '@/lib/queries'

export default async function HistoryPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // 割り勘は輪で1つのデータを見る（0037）。貯金は個人ごと
  const ownerId = await getSplitOwnerId(user.id)

  const [entries, records] = await Promise.all([
    getSavingEntries(user.id),
    getSplitRecords(ownerId),
  ])

  return <HistoryClient entries={entries} records={records} />
}
