import { redirect } from 'next/navigation'

import TaskGoogleClient from '@/components/tasks/TaskGoogleClient'
import { isCalendarConfigured, serviceAccountEmail } from '@/lib/google-calendar'
import { getConnectionView, isTodoConfigured } from '@/lib/google-tasks'
import { getSessionUser, getTaskCalendar, getTaskTodoSettings } from '@/lib/queries'

/** Google カレンダー・Google ToDo との接続の設定（0099 / 0100） */
export default async function TaskGooglePage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const [calendar, todo, connection] = await Promise.all([
    getTaskCalendar(user.id),
    getTaskTodoSettings(user.id),
    isTodoConfigured() ? getConnectionView(user.id) : Promise.resolve(null),
  ])

  return (
    <TaskGoogleClient
      userId={user.id}
      calendar={calendar}
      serviceEmail={serviceAccountEmail()}
      calendarConfigured={isCalendarConfigured()}
      todo={todo}
      connection={connection}
      todoConfigured={isTodoConfigured()}
    />
  )
}
