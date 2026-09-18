'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Checkbox, Sheet } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { opponentLabel } from '@/lib/constants'
import { shortDate } from '@/lib/format'
import type { CircleMember, Game, StadiumVisit } from '@/types'

/**
 * 一緒に行った人を選ぶ。
 *
 * 一緒に行ったのなら相手も行っているので、ここで選んだ人の帳面にも
 * 同じスタンプが付く（0039 のトリガー）。押す操作を二人ぶんやらせない。
 *
 * 誰も選ばなければ「一人で行った」。選び直しは何度でもできる。
 * ただし外したときに消えるのは、自分が付けた写しだけで、
 * 相手が自分で押した記録は残る（相手が行っていないとは限らないため）。
 */
export default function CompanionSheet({
  visit,
  game,
  members,
  userId,
  onClose,
}: {
  visit: StadiumVisit
  game: Game
  /** 貯金を共にしている人。自分は除いて出す */
  members: CircleMember[]
  userId: string
  onClose: () => void
}) {
  const router = useRouter()
  const others = members.filter((m) => m.id !== userId)
  const [picked, setPicked] = useState<string[]>(visit.companions ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: string) => {
    setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]))
  }

  const save = async () => {
    setBusy(true)
    setError(null)

    const supabase = createClient()
    const { error: saveError } = await supabase
      .from('stadium_visits')
      .update({ companions: picked })
      .eq('id', visit.id)

    setBusy(false)
    if (saveError) {
      setError('記録できませんでした')
      return
    }
    router.refresh()
    onClose()
  }

  return (
    <Sheet
      title="一緒に行った人"
      onClose={onClose}
      footer={
        <Button variant="primary" full disabled={busy} onClick={save}>
          {busy ? '保存しています' : '保存する'}
        </Button>
      }
    >
      <p className="text-[13px] text-fg-dim">
        <span className="tnum">{shortDate(game.game_date)}</span>{' '}
        {opponentLabel(game.opponent)}戦
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-fg-mute">
        選んだ人のスタンプ帳にも、同じスタンプが付きます。
        誰も選ばなければ「一人で行った」になります。
      </p>

      {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}

      {others.length === 0 ? (
        <p className="mt-4 text-[13px] text-fg-mute">
          一緒に行ける相手がまだいません。マイページでアカウントを接続すると選べます。
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {others.map((m) => (
            <Checkbox
              key={m.id}
              checked={picked.includes(m.id)}
              onChange={() => toggle(m.id)}
              label={m.member_name}
            />
          ))}
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-fg-mute">
        外したときに消えるのは、自分が付けたスタンプだけです。
        相手が自分で押した記録は残ります。
      </p>
    </Sheet>
  )
}
