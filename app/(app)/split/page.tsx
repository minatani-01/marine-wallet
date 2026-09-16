import { redirect } from 'next/navigation'
import SplitClient from '@/components/split/SplitClient'
import {
  getMarineLinks,
  getProfile,
  getSessionUser,
  getSplitMembers,
  getSplitOwnerId,
  getSplitRecords,
} from '@/lib/queries'

export default async function SplitPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>
}) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  /**
   * 割り勘は輪で1つのデータを見る（0037）。
   *
   * 「誰が立て替えて誰が負担するか」はその場に居た全員の話で、人によって
   * 中身が変わるものではない。持ち主はマスターのままで、割り勘の共有を
   * 許可された接続相手が同じものを読み書きする。
   *
   * 許可されていない人には RLS が何も返さないので、自分の分だけが見える。
   */
  const [params, profile, ownerId] = await Promise.all([
    searchParams,
    getProfile(user.id),
    getSplitOwnerId(user.id),
  ])

  const [records, members, links] = await Promise.all([
    getSplitRecords(ownerId),
    // 「あなた」は見る人によって変わる。Marine ID で突き合わせる
    getSplitMembers(ownerId, profile?.marine_id ?? null),
    // 割り勘を登録したときに、接続している相手へ知らせるために使う
    getMarineLinks(user.id),
  ])

  return (
    <SplitClient
      ownerId={ownerId}
      records={records}
      members={members}
      links={links}
      openNew={params.new === '1'}
    />
  )
}
