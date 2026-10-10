'use client'

import { useMemo, useState } from 'react'

import AutophagyCard from '@/components/body/AutophagyCard'
import CarePanel from '@/components/body/CarePanel'
import FreeWeightPanel from '@/components/body/FreeWeightPanel'
import HistoryPanel from '@/components/body/HistoryPanel'
import HomePanel from '@/components/body/HomePanel'
import ProfilePanel from '@/components/body/ProfilePanel'
import SaunaPanel from '@/components/body/SaunaPanel'
import WorkoutPanel from '@/components/body/WorkoutPanel'
import { PillTabs, SectionLabel } from '@/components/ui'
import { generatePlan, lastResultsOf } from '@/lib/reform'
import type {
  AutophagySettings,
  BodyCareLog,
  BodyProfile,
  BodyWeight,
  FreeWeightLog,
  SaunaLog,
  WorkoutSessionView,
} from '@/types'

/**
 * からだ（RE:FORM / 0064）の画面。
 *
 * もとは Google Apps Script のアプリで、上に9つのタブが並んでいた。同じ
 * 並びを画面の中のタブとして持つ。下のタブは貯金や割り勘のためのもので、
 * ここに9つ足すわけにはいかない。
 *
 * 1つにまとめた先は2つだけ。脱毛・エステ・ホワイトニングは「ケア」に
 * 入れた（入れる項目がほとんど同じ）。ワークアウトは「今日のメニュー」と
 * 「実施記録」を同じ面に置いた（始めてから付けるまでが続きの作業なので、
 * 間でタブを移らせない）。
 *
 * オートファジー（0053）はホームの一番上に残す。あれだけは記録ではなく
 * 「いま食べてよいか」なので、開いた瞬間に見えてほしい。
 */

const TABS = [
  { id: 'home', label: 'ホーム' },
  { id: 'workout', label: 'ワークアウト' },
  { id: 'free', label: 'フリーウェイト' },
  { id: 'sauna', label: 'サウナ' },
  { id: 'care', label: 'ケア' },
  { id: 'history', label: '履歴' },
  { id: 'settings', label: '設定' },
] as const

export type BodyTab = (typeof TABS)[number]['id']

export default function BodyClient({
  userId,
  settings,
  nowIso,
  today,
  profile,
  weights,
  sessions,
  freeWeights,
  saunaLogs,
  careLogs,
}: {
  userId: string
  settings: AutophagySettings | null
  /** サーバーが描いた時刻。最初の描画をブラウザと揃えるために受け取る */
  nowIso: string
  /** サーバーの今日（JST）。日付をまたぐ瞬間に食い違わないよう受け取る */
  today: string
  profile: BodyProfile | null
  weights: BodyWeight[]
  sessions: WorkoutSessionView[]
  freeWeights: FreeWeightLog[]
  saunaLogs: SaunaLog[]
  careLogs: BodyCareLog[]
}) {
  const [tab, setTab] = useState<BodyTab>('home')

  /** 日ごとの体重の、いちばん新しいもの。負荷の計算に使う */
  const latestWeight = weights.length > 0 ? weights[0].weight : (profile?.weight ?? null)

  /** 今日のメニュー。種目ごとの直近の実績から決まる */
  const plan = useMemo(
    () => generatePlan(profile, latestWeight, lastResultsOf(sessions), today),
    [profile, latestWeight, sessions, today]
  )

  return (
    <div className="flex flex-col gap-5">
      <PillTabs value={tab} options={TABS.map((t) => ({ id: t.id, label: t.label }))} onChange={setTab} />

      {tab === 'home' ? (
        <>
          <div>
            <SectionLabel>オートファジー</SectionLabel>
            <AutophagyCard userId={userId} settings={settings} nowIso={nowIso} />
          </div>

          <HomePanel
            userId={userId}
            today={today}
            profile={profile}
            weights={weights}
            latestWeight={latestWeight}
            sessions={sessions}
            freeWeights={freeWeights}
            saunaLogs={saunaLogs}
            careLogs={careLogs}
            plan={plan}
            onJump={setTab}
          />
        </>
      ) : null}

      {tab === 'workout' ? (
        <WorkoutPanel
          userId={userId}
          today={today}
          profile={profile}
          plan={plan}
          sessions={sessions}
          onJump={setTab}
        />
      ) : null}

      {tab === 'free' ? <FreeWeightPanel userId={userId} today={today} logs={freeWeights} /> : null}

      {tab === 'sauna' ? <SaunaPanel userId={userId} today={today} logs={saunaLogs} /> : null}

      {tab === 'care' ? <CarePanel userId={userId} today={today} logs={careLogs} /> : null}

      {tab === 'history' ? (
        <HistoryPanel
          weights={weights}
          sessions={sessions}
          freeWeights={freeWeights}
          saunaLogs={saunaLogs}
          careLogs={careLogs}
        />
      ) : null}

      {tab === 'settings' ? (
        <ProfilePanel userId={userId} today={today} profile={profile} />
      ) : null}
    </div>
  )
}
