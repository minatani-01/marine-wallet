import { redirect } from 'next/navigation'
import RulesClient from '@/components/savings/RulesClient'
import {
  canEditSavingRules,
  getSavingCustomPresets,
  getSavingRecordNames,
  getSavingRules,
  getSessionUser,
} from '@/lib/queries'

export default async function SavingRulesPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // ルールは全アカウント共通。変更できるかは人によって違う
  const [rules, presets, recordNames, canEdit] = await Promise.all([
    getSavingRules(),
    getSavingCustomPresets(),
    // 記録名の候補。カスタム登録のプルダウンに出すもの（0057）
    getSavingRecordNames(),
    canEditSavingRules(),
  ])

  return (
    <RulesClient
      userId={user.id}
      initialRules={rules}
      initialPresets={presets}
      initialRecordNames={recordNames}
      canEdit={canEdit}
    />
  )
}
