import { redirect } from 'next/navigation'

/** 旧 URL（0099）。設定は /tasks/google にまとめた（0100） */
export default function TaskCalendarPage() {
  redirect('/tasks/google')
}
