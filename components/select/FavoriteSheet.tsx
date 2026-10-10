'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { IconCamera, IconClose } from '@/components/icons'
import { Button, Chip, Field, Segmented, Sheet, inputClass } from '@/components/ui'
import { withTapFeedback } from '@/lib/haptics'
import { createClient } from '@/lib/supabase/client'
import {
  DEFAULT_GENRE,
  FAVORITE_STATUSES,
  parsePrice,
  rejectReason,
  removeFavoriteImage,
  uploadFavoriteImage,
} from '@/lib/favorites'
// 写真そのものの可否（形式・大きさ）は領収書と同じ基準を使う
import { rejectReason as rejectFile } from '@/lib/receipt'
import type { FavoriteItemRow } from '@/types'

const STATUS_OPTIONS = FAVORITE_STATUSES.map((s) => ({ id: s, label: s }))

/**
 * お気に入りの品を足す・直す。
 *
 * もとの Google Apps Script の入力欄をそのまま持ってきている。必須は商品名
 * だけで、他は後から足せる。思い出したときに名前だけ入れておけるほうが、
 * 全部そろうまで入れられないより残る。
 *
 * 外すのは active を false にするだけにする（0063）。間違って押しても、
 * 値段や購入先を書き直さずに戻せる。
 */
export default function FavoriteSheet({
  item,
  userId,
  genreOptions,
  onClose,
}: {
  /** null なら新しく足す */
  item: FavoriteItemRow | null
  userId: string
  /** すでに使っているジャンル。選ぶだけで書かずに済むようにする */
  genreOptions: string[]
  onClose: () => void
}) {
  const router = useRouter()

  const [genre, setGenre] = useState(item?.genre ?? DEFAULT_GENRE)
  const [name, setName] = useState(item?.name ?? '')
  const [brand, setBrand] = useState(item?.brand ?? '')
  const [price, setPrice] = useState(item?.price != null ? String(item.price) : '')
  const [status, setStatus] = useState<string>(item?.status ?? '欲しい')
  const [shopName, setShopName] = useState(item?.shop_name ?? '')
  const [shopUrl, setShopUrl] = useState(item?.shop_url ?? '')
  const [memo, setMemo] = useState(item?.memo ?? '')
  const [sortOrder, setSortOrder] = useState(String(item?.sort_order ?? 100))

  /** 今入っている写真。パスを消すと「外す」になる */
  const [imagePath, setImagePath] = useState(item?.image_path ?? '')
  const [imageUrl, setImageUrl] = useState(item?.image_url ?? '')
  const [shownUrl, setShownUrl] = useState(item?.signed_url ?? null)
  /** これから上げる写真。保存のときに上げる */
  const [picked, setPicked] = useState<File | null>(null)
  const [pickedUrl, setPickedUrl] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 選んだ写真のプレビュー。URL は使い終わったら必ず捨てる
  useEffect(() => {
    if (!picked) {
      setPickedUrl(null)
      return
    }
    const url = URL.createObjectURL(picked)
    setPickedUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [picked])

  const pickImage = (file: File | null) => {
    if (!file) return
    const reason = rejectFile(file)
    if (reason) {
      setError(reason)
      return
    }
    setError(null)
    setPicked(file)
  }

  /** 写真を外す。実体を消すのは保存のときにする */
  const clearImage = () => {
    setPicked(null)
    setImagePath('')
    setImageUrl('')
    setShownUrl(null)
  }

  const preview = pickedUrl ?? shownUrl ?? (imagePath ? null : imageUrl || null)

  const save = async () => {
    const reason = rejectReason({ name, price, shop_url: shopUrl })
    if (reason) {
      setError(reason)
      return
    }

    setSaving(true)
    setError(null)
    const supabase = createClient()

    // 写真は保存のときに上げる。選んだ時点で上げてしまうと、保存せずに
    // 閉じたぶんが Storage に残り続ける
    let nextPath = imagePath
    if (picked) {
      try {
        nextPath = await uploadFavoriteImage(supabase, userId, picked)
      } catch {
        setError('写真のアップロードに失敗しました')
        setSaving(false)
        return
      }
    }

    const payload = {
      user_id: userId,
      genre: genre.trim() || DEFAULT_GENRE,
      name: name.trim(),
      brand: brand.trim(),
      image_path: nextPath,
      // 入れ直したら、借りていたURLは持たない
      image_url: picked ? '' : imageUrl,
      price: parsePrice(price),
      memo: memo.trim(),
      status: status.trim() || '欲しい',
      shop_name: shopName.trim(),
      shop_url: shopUrl.trim(),
      sort_order: Number(sortOrder) || 100,
    }

    const { error: saveError } = item
      ? await supabase.from('favorite_items').update(payload).eq('id', item.id)
      : await supabase.from('favorite_items').insert(payload)

    setSaving(false)
    if (saveError) {
      setError('保存に失敗しました')
      return
    }

    // 保存できてから、参照されなくなった写真を消す。先に消すと、
    // 保存に失敗したときに写真だけ失うことになる
    const oldPath = item?.image_path ?? ''
    if (oldPath && oldPath !== nextPath) {
      await removeFavoriteImage(supabase, oldPath)
    }

    onClose()
    router.refresh()
  }

  const remove = async () => {
    if (!item) return
    if (!confirm(`「${item.name}」を一覧から外しますか？`)) return

    setSaving(true)
    const supabase = createClient()
    const { error: removeError } = await supabase
      .from('favorite_items')
      .update({ active: false })
      .eq('id', item.id)

    setSaving(false)
    if (removeError) {
      setError('外せませんでした')
      return
    }

    onClose()
    router.refresh()
  }

  return (
    <Sheet
      title={item ? 'お気に入りを編集' : 'お気に入りを追加'}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {error ? <p className="text-[12px] text-danger">{error}</p> : null}
          <div className="flex gap-2">
            {item ? (
              <Button variant="danger" onClick={() => void remove()} disabled={saving}>
                外す
              </Button>
            ) : null}
            <Button
              variant="primary"
              full
              onClick={withTapFeedback(() => void save())}
              disabled={saving || !name.trim()}
            >
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="商品名">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="三輪山本 手延べそうめん"
            className={inputClass}
          />
        </Field>

        <Field label="ジャンル" hint="書いたものが候補に増えます">
          {genreOptions.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {genreOptions.map((g) => (
                <Chip key={g} selected={genre === g} onClick={() => setGenre(g)}>
                  {g}
                </Chip>
              ))}
            </div>
          ) : null}
          <input
            type="text"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            placeholder={DEFAULT_GENRE}
            className={inputClass}
          />
        </Field>

        <Field label="ブランド・メーカー" hint="任意">
          <input
            type="text"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="三輪山本"
            className={inputClass}
          />
        </Field>

        <Field label="写真" hint="1枚まで（任意）">
          {preview ? (
            <div className="relative">
              <img
                src={preview}
                alt="選んだ写真"
                className="max-h-56 w-full rounded-xl border border-line bg-ink-2 object-contain"
              />
              <button
                type="button"
                aria-label="写真を外す"
                title="写真を外す"
                onClick={withTapFeedback(clearImage)}
                className="absolute top-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-ink/85 text-fg-mute backdrop-blur transition-colors hover:border-danger/50 hover:text-danger"
              >
                <IconClose size={14} />
              </button>
              {picked ? (
                <p className="mt-1.5 text-[11px] text-fg-mute">保存すると差し替わります</p>
              ) : null}
              {!picked && !imagePath && imageUrl ? (
                <p className="mt-1.5 text-[11px] text-warn">
                  Google Drive から借りています。写真を選び直すとこのアプリの中に入ります。
                </p>
              ) : null}
            </div>
          ) : (
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line py-4 text-[13px] text-fg-mute transition-colors hover:border-marine/50 hover:text-marine">
              <IconCamera size={16} />
              写真を選ぶ
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  pickImage(e.target.files?.[0] ?? null)
                  // 同じ写真をもう一度選べるようにする
                  e.target.value = ''
                }}
              />
            </label>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="価格" hint="任意">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="6480"
              className={`tnum ${inputClass}`}
            />
          </Field>
          <Field label="表示順" hint="小さいほど先">
            <input
              type="number"
              inputMode="numeric"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className={`tnum ${inputClass}`}
            />
          </Field>
        </div>

        <Field label="ステータス">
          <Segmented value={status} options={STATUS_OPTIONS} onChange={setStatus} />
        </Field>

        <Field label="購入先" hint="任意">
          <input
            type="text"
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            placeholder="公式オンラインストア"
            className={inputClass}
          />
        </Field>

        <Field label="購入URL" hint="任意">
          <input
            type="url"
            inputMode="url"
            value={shopUrl}
            onChange={(e) => setShopUrl(e.target.value)}
            placeholder="https://"
            className={inputClass}
          />
        </Field>

        <Field label="メモ" hint="任意">
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={3}
            placeholder="細い麺のほうが好み。2束で1人前"
            className={`${inputClass} resize-none`}
          />
        </Field>
      </div>
    </Sheet>
  )
}
