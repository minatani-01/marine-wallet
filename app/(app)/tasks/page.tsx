import { redirect } from 'next/navigation'

import TasksClient from '@/components/tasks/TasksClient'
import { isCalendarConfigured } from '@/lib/google-calendar'
import { getConnectionView, isTodoConfigured } from '@/lib/google-tasks'
import { jstDate } from '@/lib/jst'
import { getSessionUser, getTaskCalendar, getTaskTags, getTaskTodoSettings, getTasks } from '@/lib/queries'

/**
 * タスク・ToDo（0099）。全員の画面。
 *
 * 今日の日付は日本時間に直してから渡す。ここは UTC で動いているので、
 * そのまま渡すと 0時〜9時のあいだ「今日」が1日ずれる。
 */
export default async function TasksPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const [tasks, tags, calendar, todo, connection] = await Promise.all([
    getTasks(user.id),
    getTaskTags(user.id),
    getTaskCalendar(user.id),
    getTaskTodoSettings(user.id),
    isTodoConfigured() ? getConnectionView(user.id) : Promise.resolve(null),
  ])

  return (
    <TasksClient
      userId={user.id}
      tasks={tasks}
      tags={tags}
      calendarReady={Boolean(calendar?.enabled && isCalendarConfigured())}
      todoReady={Boolean(connection && (todo?.enabled ?? true))}
      today={jstDate(new Date())}
    />
  )
}
