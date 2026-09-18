'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Chip, Field, Sheet, inputClassCompact } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { PLACE_KINDS, placeKindLabel } from '@/lib/places'
import { HOME_STADIUMS, REGIONAL_STADIUMS } from '@/lib/stadiums'
import { tapFeedback } from '@/lib/haptics'
import type { Place, PlaceKind } from '@/types'

/**
 * 行きたい場所の登録と編集。
 *
 * 入れるのは名前だけで足りる。場所の手がかり（area）は Google マップで
 * 開くときの検索に混ぜるためのもので、同名の別店舗に飛ばさないために効く。
 *
 * 球場を結び付けておくと、遠征のときに球場ごとにまとめて見られる。
 * 地図の鍵は要らない。座標は持たず、開くときに名前で検索する。
 */
export default function PlaceSheet({
  place,
  userId,
  onClose,
}: {
  place: Place | null
  userId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [kind, setKind] = useState<PlaceKind>(place?.kind ?? 'food')
  const [name, setName] = useState(place?.name ?? '')
  const [area, setArea] = useState(place?.area ?? '')
  const [url, setUrl] = useState(place?.url ?? '')
  const [note, setNote] = useState(place?.note ?? '')
  const [stadiumId, setStadiumId] = useState(place?.stadium_id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = name.trim().length > 0

  const submit = async () => {
    if (!canSubmit) return
    setSaving(true)
    setError(null)

    const supabase = createClient()
    const row = {
      kind,
      name: name.trim(),
      area: area.trim(),
      url: url.trim(),
      note: note.trim(),
      stadium_id: stadiumId || null,
    }

    const saved = place
      ? await supabase.from('places').update(row).eq('id', place.id).select('id').maybeSingle()
      : await supabase
          .from('places')
          .insert({ ...row, created_by: userId })
          .select('id')
          .maybeSingle()

    if (saved.error) {
      setSaving(false)
      setError('保存できませんでした')
      return
    }

    // 地図に出すための座標を、この1件だけ引く。引けなくても保存は済んでいる
    if (saved.data?.id) {
      await fetch('/api/places/geocode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: saved.data.id }),
      }).catch(() => null)
    }

    setSaving(false)
    router.refresh()
    onClose()
  }

  return (
    <Sheet
      title={place ? '場所を編集' : '行きたい場所を追加'}
      onClose={onClose}
      footer={
        <Button variant="primary" full disabled={!canSubmit || saving} onClick={submit}>
          {saving ? '保存しています' : '保存する'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="種別">
          <div className="flex flex-wrap gap-2">
            {PLACE_KINDS.map((k) => (
              <Chip
                key={k}
                selected={kind === k}
                onClick={() => {
                  tapFeedback()
                  setKind(k)
                }}
              >
                {placeKindLabel(k)}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="名前">
          <input
            className={inputClassCompact}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例）寿司大"
          />
        </Field>

        <Field label="場所" hint="地図で開くときの手がかり">
          <input
            className={inputClassCompact}
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="例）幕張"
          />
        </Field>

        <Field label="近い球場" hint="遠征のときにまとめて見られます">
          <select
            className={inputClassCompact}
            value={stadiumId}
            onChange={(e) => setStadiumId(e.target.value)}
          >
            <option value="">選ばない</option>
            <optgroup label="本拠地">
              {HOME_STADIUMS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.short}
                </option>
              ))}
            </optgroup>
            <optgroup label="地方球場">
              {REGIONAL_STADIUMS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.short}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>

        <Field label="リンク" hint="任意">
          <input
            className={inputClassCompact}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            inputMode="url"
          />
        </Field>

        <Field label="メモ" hint="任意">
          <input
            className={inputClassCompact}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例）土日は行列"
          />
        </Field>

        {error ? <p className="text-[13px] text-danger">{error}</p> : null}

        <p className="text-[11px] leading-relaxed text-fg-mute">
          リストは一緒に貯めているメンバー全員で共有します。誰でも足せて、直せます。
        </p>
      </div>
    </Sheet>
  )
}
