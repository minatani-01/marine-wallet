import { redirect } from 'next/navigation'

import TaskCalendarClient from '@/components/tasks/TaskCalendarClient'
import { isCalendarConfigured, serviceAccountEmail } from '@/lib/google-calendar'
import { getSessionUser, getTaskCalendar } from '@/lib/queries'

/** Google カレンダーとの接続の設定（0099） */
export default async function TaskCalendarPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const calendar = await getTaskCalendar(user.id)

  return (
    <TaskCalendarClient
      userId={user.id}
      calendar={calendar}
      serviceEmail={serviceAccountEmail()}
      configured={isCalendarConfigured()}
    />
  )
}
