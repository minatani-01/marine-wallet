'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Chip, Field, Sheet, inputClassCompact } from '@/components/ui'
import { IconSearch } from '@/components/icons'
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
 *
 * 名前で探して選べば、名前・住所・座標がそのまま入る。手で書くより速く、
 * 座標を引き直す必要も無い。探さずに手で書いても同じように使える。
 */

type Hit = { name: string; address: string; lat: number; lng: number }
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

  // 名前で探す。押したときだけ1回呼ぶ（打つたびには呼ばない）
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchNote, setSearchNote] = useState<string | null>(null)
  /** 検索で選んだ座標。選んでいれば保存時にそのまま入れる */
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null)

  const search = async () => {
    const text = query.trim()
    if (text.length < 2) return

    tapFeedback()
    setSearching(true)
    setSearchNote(null)
    setHits(null)

    const res = await fetch('/api/places/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: text }),
    }).catch(() => null)

    setSearching(false)

    if (res?.status === 429) {
      setSearchNote('今日はここまでです。名前と場所を手で入れてください。')
      return
    }
    if (!res?.ok) {
      setSearchNote('探せませんでした。名前と場所を手で入れてください。')
      return
    }

    const body = (await res.json()) as { hits?: Hit[] }
    setHits(body.hits ?? [])
    if ((body.hits ?? []).length === 0) {
      setSearchNote('見つかりませんでした。地名を足すと当たりやすくなります。')
    }
  }

  /** 候補を選ぶ。名前・場所・座標がそのまま入る */
  const pick = (hit: Hit) => {
    tapFeedback()
    setName(hit.name)
    setArea(hit.address)
    setPicked({ lat: hit.lat, lng: hit.lng })
    setHits(null)
    setSearchNote(null)
  }

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
      // 検索で選んだなら座標は分かっている。引き直す必要は無い
      ...(picked
        ? {
            lat: picked.lat,
            lng: picked.lng,
            geocoded_at: new Date().toISOString(),
            geocoded_query: [area.trim(), name.trim()].filter(Boolean).join(' '),
          }
        : {}),
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

    // 地図に出すための座標を、この1件だけ引く。引けなくても保存は済んでいる。
    // 検索で選んだ場合は座標が入っているので呼ばない
    if (saved.data?.id && !picked) {
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
        <Field label="名前で探す" hint="選ぶと名前・場所・位置が入ります">
          <div className="flex gap-2">
            <input
              className={inputClassCompact}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void search()
                }
              }}
              placeholder="例）ゑぶり亭 横浜"
            />
            <Button
              variant="outline"
              className="!min-h-[42px] shrink-0 !px-3"
              disabled={searching || query.trim().length < 2}
              onClick={search}
            >
              <span className="flex items-center gap-1.5 text-[13px]">
                <IconSearch size={15} />
                {searching ? '探しています' : '探す'}
              </span>
            </Button>
          </div>

          {hits && hits.length > 0 ? (
            <div className="divide-hairline mt-2 rounded-xl border border-line">
              {hits.map((hit) => (
                <button
                  key={`${hit.name}-${hit.lat}`}
                  type="button"
                  onClick={() => pick(hit)}
                  className="block w-full px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
                >
                  <div className="truncate text-[13px]">{hit.name}</div>
                  <div className="truncate text-[11px] text-fg-mute">{hit.address}</div>
                </button>
              ))}
            </div>
          ) : null}

          {searchNote ? (
            <p className="mt-2 text-[11px] leading-relaxed text-fg-mute">{searchNote}</p>
          ) : null}
        </Field>

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
