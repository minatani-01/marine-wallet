'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Chip, Field, Sheet, inputClassCompact } from '@/components/ui'
import { IconSearch } from '@/components/icons'
import { createClient } from '@/lib/supabase/client'
import { PLACE_KINDS, hasGenre, placeKindLabel, shortArea, toggleTag } from '@/lib/places'
import { tapFeedback } from '@/lib/haptics'
import type { Place, PlaceGenre, PlaceKind, PlaceTagKind } from '@/types'

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

type Hit = {
  name: string
  address: string
  lat: number
  lng: number
  /** Google の種類から決めた種別。決まらなければ null（0051） */
  kind: PlaceKind | null
  /** Google の種類から決めたジャンル。飲食のときだけ入る */
  genres: string[]
}

/**
 * 候補の札。
 *
 * 候補に無い言葉も選んだものとして出す。設定画面から消したあとも、
 * その場所に付いている言葉は残るため（0044）。
 */
function TagChips({
  options,
  selected,
  onToggle,
}: {
  options: PlaceGenre[]
  selected: string[]
  onToggle: (name: string) => void
}) {
  const names = [...options.map((o) => o.name)]
  for (const name of selected) if (!names.includes(name)) names.push(name)

  if (names.length === 0) {
    return <p className="text-[11px] text-fg-mute">候補がありません。下から足せます。</p>
  }

  return (
    <div className="flex flex-wrap gap-2">
      {names.map((name) => (
        <Chip
          key={name}
          selected={selected.includes(name)}
          onClick={() => {
            tapFeedback()
            onToggle(name)
          }}
        >
          {name}
        </Chip>
      ))}
    </div>
  )
}
export default function PlaceSheet({
  place,
  genres: genreOptions,
  userId,
  onClose,
}: {
  place: Place | null
  /** ジャンルと食材の候補。設定画面で足せる */
  genres: PlaceGenre[]
  userId: string
  onClose: () => void
}) {
  const router = useRouter()

  /** 候補をジャンルと食材に分ける */
  const options: Record<PlaceTagKind, PlaceGenre[]> = {
    genre: genreOptions.filter((g) => g.kind !== 'ingredient'),
    ingredient: genreOptions.filter((g) => g.kind === 'ingredient'),
  }

  const [kind, setKind] = useState<PlaceKind>(place?.kind ?? 'food')
  const [name, setName] = useState(place?.name ?? '')
  const [area, setArea] = useState(place?.area ?? '')
  const [url, setUrl] = useState(place?.url ?? '')
  const [note, setNote] = useState(place?.note ?? '')
  const [genres, setGenres] = useState<string[]>(place?.genres ?? [])
  const [ingredients, setIngredients] = useState<string[]>(place?.ingredients ?? [])
  /** 候補に無い言葉を足すための入力。押したときだけ足す */
  const [adding, setAdding] = useState('')
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

  /**
   * 候補を選ぶ。名前・場所・座標に加えて、種別とジャンルも入る。
   *
   * 飲食店かどうかも、寿司かラーメンかも Google が持っている（0051）。
   * 手で入れ直す理由が無い。押したあとに直せるので、外れていても困らない。
   */
  const pick = (hit: Hit) => {
    tapFeedback()
    setName(hit.name)
    // 完全な住所をそのまま持つと、一覧が住所で埋まる。町名までにする
    setArea(shortArea(hit.address))
    if (hit.kind) {
      setKind(hit.kind)
      if (!hasGenre(hit.kind)) {
        setGenres([])
        setIngredients([])
      }
    }
    if (hit.genres.length > 0 && (!hit.kind || hasGenre(hit.kind))) {
      setGenres((now) => {
        const merged = [...now]
        for (const genre of hit.genres) if (!merged.includes(genre)) merged.push(genre)
        return merged
      })
    }
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
      genres: hasGenre(kind) ? genres : [],
      ingredients: hasGenre(kind) ? ingredients : [],
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
              placeholder="場所の名前を入力"
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
                  // 観光地にジャンル・食材は無い。切り替えたら持ち越さない
                  if (!hasGenre(k)) {
                    setGenres([])
                    setIngredients([])
                  }
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

        {hasGenre(kind) ? (
          <>
            <Field label="ジャンル" hint="いくつでも選べます">
              <TagChips
                options={options.genre}
                selected={genres}
                onToggle={(name) => setGenres(toggleTag(genres, name))}
              />
            </Field>

            {/* 食材はジャンルとは別の軸。焼肉の中の牛・豚・鶏を分ける */}
            <Field label="食材" hint="いくつでも選べます">
              <TagChips
                options={options.ingredient}
                selected={ingredients}
                onToggle={(name) => setIngredients(toggleTag(ingredients, name))}
              />
            </Field>

            {/* 候補に無い言葉を、その場で足す */}
            <Field label="候補に無い言葉を足す" hint="押した側に入ります">
              <div className="flex gap-2">
                <input
                  className={inputClassCompact}
                  value={adding}
                  onChange={(e) => setAdding(e.target.value)}
                  placeholder="例）立ち食いそば"
                />
                <Button
                  variant="outline"
                  className="!min-h-[42px] shrink-0 !px-3"
                  disabled={adding.trim().length === 0}
                  onClick={() => {
                    tapFeedback()
                    setGenres(toggleTag(genres, adding.trim()))
                    setAdding('')
                  }}
                >
                  <span className="text-[13px]">ジャンル</span>
                </Button>
                <Button
                  variant="outline"
                  className="!min-h-[42px] shrink-0 !px-3"
                  disabled={adding.trim().length === 0}
                  onClick={() => {
                    tapFeedback()
                    setIngredients(toggleTag(ingredients, adding.trim()))
                    setAdding('')
                  }}
                >
                  <span className="text-[13px]">食材</span>
                </Button>
              </div>
            </Field>
          </>
        ) : null}

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
