'use client'

import { LogList, LogRow } from '@/components/body/parts'
import { CARE_KINDS, effortLabel } from '@/lib/reform'
import type {
  BodyCareLog,
  BodyWeight,
  FreeWeightLog,
  SaunaLog,
  WorkoutSessionView,
} from '@/types'

/**
 * 履歴。
 *
 * 付ける面にも直近ぶんは出しているので、ここは「まとめて振り返る」ためだけに
 * 置く。体重は前の日との差を添える。増えたか減ったかは、数字を並べるより
 * 差で見るほうが早い。
 */
export default function HistoryPanel({
  weights,
  sessions,
  freeWeights,
  saunaLogs,
  careLogs,
}: {
  weights: BodyWeight[]
  sessions: WorkoutSessionView[]
  freeWeights: FreeWeightLog[]
  saunaLogs: SaunaLog[]
  careLogs: BodyCareLog[]
}) {
  return (
    <div className="flex flex-col gap-3">
      <LogList title="ワークアウト" count={sessions.length}>
        {sessions.slice(0, 20).map((session) => (
          <LogRow key={session.id} date={session.date} right={`${session.duration}分`}>
            {session.exercises
              .filter((e) => e.kind !== 'cardio')
              .map((e) => (
                <span key={e.id} className="block truncate">
                  {e.name}
                  {e.actual_weight != null ? ` ${e.actual_weight}kg` : ''}
                  {e.actual_reps.length > 0 ? ` ${e.actual_reps.join('/')}回` : ''}
                </span>
              ))}
          </LogRow>
        ))}
      </LogList>

      <LogList title="体重" count={weights.length}>
        {weights.slice(0, 30).map((row, index) => {
          // 新しい順に並んでいるので、次の要素が「前の日」になる
          const before = weights[index + 1]
          const diff = before ? row.weight - before.weight : null
          return (
            <LogRow
              key={row.id}
              date={row.date}
              right={
                diff != null ? (
                  <span className={diff < 0 ? 'text-marine' : diff > 0 ? 'text-warn' : ''}>
                    {diff >= 0 ? '+' : ''}
                    {diff.toFixed(1)}kg
                  </span>
                ) : undefined
              }
            >
              <span className="tnum font-semibold text-fg">{row.weight.toFixed(1)}kg</span>
            </LogRow>
          )
        })}
      </LogList>

      <LogList title="フリーウェイト" count={freeWeights.length}>
        {freeWeights.slice(0, 20).map((log) => (
          <LogRow key={log.id} date={log.date} right={`${log.weight}kg`}>
            <span className="block truncate">{log.exercise}</span>
            <span className="tnum block text-[11px] text-fg-mute">
              {log.reps}回 × {log.sets}セット｜{effortLabel(log.effort)}
            </span>
          </LogRow>
        ))}
      </LogList>

      <LogList title="サウナ" count={saunaLogs.length}>
        {saunaLogs.slice(0, 20).map((log) => (
          <LogRow key={log.id} date={log.date} right={`${log.sauna_minutes}分×${log.sets}`}>
            <span className="block truncate">
              {log.kind}
              {log.temperature != null ? `｜${log.temperature}℃` : ''}
            </span>
          </LogRow>
        ))}
      </LogList>

      {CARE_KINDS.map((care) => {
        const rows = careLogs.filter((log) => log.kind === care.id)
        return (
          <LogList key={care.id} title={care.label} count={rows.length}>
            {rows.slice(0, 20).map((log) => (
              <LogRow key={log.id} date={log.date} right={`${log.minutes}分`}>
                <span className="block truncate">
                  {log.kind === 'whitening' ? `${log.count}回` : log.part}
                  {log.level ? `｜Lv.${log.level}` : ''}
                </span>
              </LogRow>
            ))}
          </LogList>
        )
      })}
    </div>
  )
}
