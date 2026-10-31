import { redirect } from 'next/navigation'

import TasksClient from '@/components/tasks/TasksClient'
import { isCalendarConfigured } from '@/lib/google-calendar'
import { jstDate } from '@/lib/jst'
import { getSessionUser, getTaskCalendar, getTaskTags, getTasks } from '@/lib/queries'

/**
 * タスク・ToDo（0099）。全員の画面。
 *
 * 今日の日付は日本時間に直してから渡す。ここは UTC で動いているので、
 * そのまま渡すと 0時〜9時のあいだ「今日」が1日ずれる。
 */
export default async function TasksPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const [tasks, tags, calendar] = await Promise.all([
    getTasks(user.id),
    getTaskTags(user.id),
    getTaskCalendar(user.id),
  ])

  return (
    <TasksClient
      userId={user.id}
      tasks={tasks}
      tags={tags}
      calendarReady={Boolean(calendar?.enabled && isCalendarConfigured())}
      today={jstDate(new Date())}
    />
  )
}
