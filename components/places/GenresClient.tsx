'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, EmptyState, IconButton, SectionLabel, inputClassCompact } from '@/components/ui'
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconClose,
  IconEdit,
  IconPlus,
  IconTrash,
} from '@/components/icons'
import { createClient } from '@/lib/supabase/client'
import { reorderGenres } from '@/lib/place-genres'
import { tapFeedback } from '@/lib/haptics'
import type { PlaceGenre } from '@/types'

/**
 * 飲食のジャンルの候補を足す・直す・消す・並べ替える。
 *
 * 候補をコードに書いていると、「立ち食いそば」を足すのにデプロイが要る。
 * 貯金のカスタム登録の定型と同じで、ここから増やせるようにする。
 *
 * 名前を直すと、その言葉を使っている場所も追いかけて直る（0044 のトリガー）。
 * 追いかけないと、直した瞬間に既存の店が絞り込みから外れる。
 * 消したときは場所に書かれた言葉をそのまま残す。候補から外れるだけで、
 * 記録が消える理由は無い。
 *
 * 並びは登録画面の候補と、マップのジャンルの並びに効く。よく使うものを
 * 上に置けるようにする。
 */
export default function GenresClient({ genres }: { genres: PlaceGenre[] }) {
  const router = useRouter()
  const [adding, setAdding] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * 画面に出している並び。
   *
   * 押した瞬間に動かしたいので、サーバーの返事を待たずにここで入れ替える。
   * 待つと、押してから動くまでの間に二度押しされる。保存に失敗したときは
   * 元に戻す。
   */
  const [rows, setRows] = useState<PlaceGenre[]>(genres)
  useEffect(() => setRows(genres), [genres])

  const add = async () => {
    const name = adding.trim()
    if (!name) return

    tapFeedback()
    setBusy(true)
    setError(null)

    const supabase = createClient()
    const { error: saveError } = await supabase
      .from('place_genres')
      .insert({ name, sort_order: (rows.at(-1)?.sort_order ?? 0) + 10 })

    setBusy(false)
    if (saveError) {
      setError(
        saveError.code === '23505' ? 'その名前はすでにあります' : '足せませんでした'
      )
      return
    }
    setAdding('')
    router.refresh()
  }

  const rename = async () => {
    if (!editing) return
    const name = editing.name.trim()
    if (!name) return

    setBusy(true)
    setError(null)

    const supabase = createClient()
    const { error: saveError } = await supabase
      .from('place_genres')
      .update({ name })
      .eq('id', editing.id)

    setBusy(false)
    if (saveError) {
      setError(saveError.code === '23505' ? 'その名前はすでにあります' : '直せませんでした')
      return
    }
    setEditing(null)
    router.refresh()
  }

  /**
   * 1つ上・1つ下へ動かす。
   *
   * 動いたあとの並び順を全体に振り直して書き戻す。隣と入れ替えるだけだと、
   * 同じ並び順が並んでいるとき（既定値のまま足したとき）に何も起きない。
   */
  const move = async (genre: PlaceGenre, direction: -1 | 1) => {
    const { rows: next, changed } = reorderGenres(rows, genre.id, direction)
    if (changed.length === 0) return

    tapFeedback()
    const before = rows
    setRows(next)
    setBusy(true)
    setError(null)

    const supabase = createClient()
    for (const row of changed) {
      const { error: saveError } = await supabase
        .from('place_genres')
        .update({ sort_order: row.sort_order })
        .eq('id', row.id)

      if (saveError) {
        setBusy(false)
        setRows(before)
        setError('並びを保存できませんでした')
        return
      }
    }

    setBusy(false)
    router.refresh()
  }

  const remove = async (genre: PlaceGenre) => {
    if (
      !window.confirm(
        `「${genre.name}」を候補から消しますか？（登録済みの場所のジャンルはそのまま残ります）`
      )
    ) {
      return
    }

    setBusy(true)
    const supabase = createClient()
    await supabase.from('place_genres').delete().eq('id', genre.id)
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="eyebrow">飲食のジャンル</div>
        <p className="mt-2 text-[11px] leading-relaxed text-fg-mute">
          場所を登録するときの候補です。ここに無い言葉も、登録画面で直接入れられます。
          観光地にジャンルはありません。
        </p>

        <div className="mt-3 flex gap-2">
          <input
            className={inputClassCompact}
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void add()
              }
            }}
            placeholder="例）立ち食いそば"
          />
          <Button
            variant="primary"
            className="!min-h-[42px] shrink-0 !px-3"
            disabled={busy || adding.trim().length === 0}
            onClick={add}
          >
            <span className="flex items-center gap-1 text-[13px]">
              <IconPlus size={15} />
              足す
            </span>
          </Button>
        </div>

        {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
      </Card>

      <div>
        <SectionLabel>候補</SectionLabel>
        {rows.length === 0 ? (
          <EmptyState
            title="候補がありません"
            description="よく使うジャンルを足しておくと、登録が速くなります。"
          />
        ) : (
          <Card padded={false}>
            <div className="divide-hairline px-4">
              {rows.map((genre, index) => (
                <div key={genre.id} className="flex items-center gap-2 py-2.5">
                  {editing?.id === genre.id ? (
                    <>
                      <input
                        className={inputClassCompact}
                        value={editing.name}
                        autoFocus
                        onChange={(e) => setEditing({ id: genre.id, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void rename()
                          }
                        }}
                      />
                      <div className="flex shrink-0 gap-1.5">
                        <IconButton label="決定" disabled={busy} onClick={rename}>
                          <IconCheck size={15} />
                        </IconButton>
                        <IconButton label="やめる" onClick={() => setEditing(null)}>
                          <IconClose size={15} />
                        </IconButton>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* 並び替え。上端・下端では押せない */}
                      <div className="flex shrink-0 flex-col gap-0.5">
                        <IconButton
                          label="上へ"
                          disabled={busy || index === 0}
                          onClick={() => move(genre, -1)}
                          className="!h-[26px] !w-8"
                        >
                          <IconChevronUp size={14} />
                        </IconButton>
                        <IconButton
                          label="下へ"
                          disabled={busy || index === rows.length - 1}
                          onClick={() => move(genre, 1)}
                          className="!h-[26px] !w-8"
                        >
                          <IconChevronDown size={14} />
                        </IconButton>
                      </div>

                      <span className="min-w-0 flex-1 truncate text-sm">{genre.name}</span>

                      <div className="flex shrink-0 gap-1.5">
                        <IconButton
                          label="名前を直す"
                          onClick={() => setEditing({ id: genre.id, name: genre.name })}
                        >
                          <IconEdit size={15} />
                        </IconButton>
                        <IconButton
                          label="消す"
                          disabled={busy}
                          onClick={() => remove(genre)}
                          className="hover:border-danger/50 hover:text-danger"
                        >
                          <IconTrash size={15} />
                        </IconButton>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-fg-mute">
        上下の矢印で並びを変えられます。ここの並びが、登録画面の候補とマップの
        ジャンルの並びになります。
        名前を直すと、その言葉で登録済みの場所も一緒に直ります。
        消した場合は、登録済みの場所のジャンルはそのまま残ります（候補から外れるだけです）。
      </p>
    </div>
  )
}
