'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { IconClose, IconPlus, IconTrash } from '@/components/icons'
import {
  Button,
  Card,
  EmptyState,
  Field,
  PickList,
  Sheet,
  inputClass,
  inputClassCompact,
} from '@/components/ui'
import { withTapFeedback } from '@/lib/haptics'
import {
  DRINK_UNITS,
  MAX_ITEMS,
  cleanItems,
  emptyItem,
  itemText,
  needsAmount,
  rejectRecipeReason,
  toItems,
  type DrinkItem,
  type DrinkUnit,
} from '@/lib/drinks'
import { createClient } from '@/lib/supabase/client'
import type { DrinkRecipe } from '@/types'

/**
 * 特製ドリンクのレシピ（0069 / 0071）。
 *
 * 断食の前後や運動のあとに作るものが決まってくる。そのたびに思い出すのでは
 * 分量が毎回ぶれるし、良かった配合を忘れる。書いて残しておく。
 *
 * 置くのは名前と分量だけ。いつ飲むかや作り方まで持たせると、書くことが
 * 増えて残らなくなる。
 *
 * 分量は「名前・数・単位」に分けて入れてもらう。自由に書けると、
 * 「水300」「水 300ml」「お水300cc」が並んで、同じものか見分けが付かない。
 */
export default function DrinkRecipes({
  userId,
  recipes,
}: {
  userId: string
  recipes: DrinkRecipe[]
}) {
  /** 編集中。null は「追加」で開いたとき。閉じているあいだは undefined */
  const [editing, setEditing] = useState<DrinkRecipe | null | undefined>(undefined)

  return (
    <div>
      {recipes.length === 0 ? (
        <EmptyState
          title="まだレシピがありません"
          description="下の + から、よく作るものを書いておけます。"
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {recipes.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} onEdit={() => setEditing(recipe)} />
          ))}
        </div>
      )}

      <Button
        variant="outline"
        full
        className="mt-2.5"
        onClick={withTapFeedback(() => setEditing(null))}
      >
        <IconPlus size={15} />
        レシピを足す
      </Button>

      {editing !== undefined ? (
        <RecipeSheet
          recipe={editing}
          userId={userId}
          count={recipes.length}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </div>
  )
}

/**
 * 1件ぶん。
 *
 * 分量はたたまずに全部出す。作っている最中に開き直すことになるのでは、
 * 置いておく意味が薄い。
 */
function RecipeCard({ recipe, onEdit }: { recipe: DrinkRecipe; onEdit: () => void }) {
  const items = toItems(recipe.items)

  return (
    <Card className="!p-0">
      <button
        type="button"
        onClick={withTapFeedback(onEdit)}
        aria-label={`${recipe.name}を編集`}
        className="w-full p-3.5 text-left transition-colors hover:bg-white/[0.03]"
      >
        <span className="block truncate text-[14px] font-semibold">{recipe.name}</span>

        {items.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1">
            {items.map((item, index) => (
              <li
                key={`${item.name}-${index}`}
                className="flex items-baseline gap-2 text-[12px] text-fg-dim"
              >
                <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-teal" />
                <span className="min-w-0">{itemText(item)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </button>
    </Card>
  )
}

/**
 * 足す・直す。
 *
 * 消すのもここに置く。一覧に消すボタンを並べると、分量を読みに来ただけの
 * ときに押してしまう。
 */
function RecipeSheet({
  recipe,
  userId,
  count,
  onClose,
}: {
  /** null なら新しく足す */
  recipe: DrinkRecipe | null
  userId: string
  /** いま何件あるか。足すときの並び順に使う */
  count: number
  onClose: () => void
}) {
  const router = useRouter()

  const [name, setName] = useState(recipe?.name ?? '')
  /** 1行は必ず出しておく。空の枠があるほうが、何を入れるのか分かる */
  const [items, setItems] = useState<DrinkItem[]>(() => {
    const saved = toItems(recipe?.items)
    return saved.length > 0 ? saved : [emptyItem()]
  })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patch = (index: number, next: Partial<DrinkItem>) => {
    setItems((all) => all.map((item, i) => (i === index ? { ...item, ...next } : item)))
  }

  const save = async () => {
    const reason = rejectRecipeReason({ name, items })
    if (reason) {
      setError(reason)
      return
    }

    setSaving(true)
    setError(null)
    const supabase = createClient()

    const payload = { user_id: userId, name: name.trim(), items: cleanItems(items) }

    const { error: failed } = recipe
      ? await supabase.from('drink_recipes').update(payload).eq('id', recipe.id)
      : await supabase.from('drink_recipes').insert({ ...payload, sort_order: count })

    setSaving(false)
    if (failed) {
      setError('保存できませんでした')
      return
    }
    onClose()
    router.refresh()
  }

  const remove = async () => {
    if (!recipe) return
    if (!window.confirm(`「${recipe.name}」を消しますか？`)) return

    setSaving(true)
    const supabase = createClient()
    const { error: failed } = await supabase.from('drink_recipes').delete().eq('id', recipe.id)

    setSaving(false)
    if (failed) {
      setError('消せませんでした')
      return
    }
    onClose()
    router.refresh()
  }

  return (
    <Sheet
      title={recipe ? 'レシピを編集' : 'レシピを足す'}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {error ? <p className="text-[12px] text-danger">{error}</p> : null}
          <div className="flex gap-2">
            {recipe ? (
              <Button
                variant="danger"
                className="shrink-0"
                aria-label="このレシピを消す"
                onClick={withTapFeedback(() => void remove())}
                disabled={saving}
              >
                <IconTrash size={15} />
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
        <Field label="名前">
          <input
            type="text"
            value={name}
            aria-label="名前"
            onChange={(e) => setName(e.target.value)}
            placeholder="断食明けドリンク"
            className={inputClass}
          />
        </Field>

        {/* 名前・数・単位に分ける。自由に書かせると、同じものが別の書き方で
            並んで見分けが付かなくなる */}
        <Field label="分量">
          <div className="flex flex-col gap-2">
            {items.map((item, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={item.name}
                  aria-label={`材料${index + 1}`}
                  onChange={(e) => patch(index, { name: e.target.value })}
                  placeholder="水"
                  className={`${inputClassCompact} min-w-0 flex-1`}
                />

                {/* 適量に数は無い。欄を出したままにすると、入れるものだと思う */}
                {needsAmount(item.unit) ? (
                  <input
                    type="number"
                    inputMode="decimal"
                    aria-label={`材料${index + 1}の数`}
                    value={item.amount ?? ''}
                    min={0}
                    step="any"
                    onChange={(e) =>
                      patch(index, { amount: e.target.value === '' ? null : Number(e.target.value) })
                    }
                    placeholder="300"
                    className={`${inputClassCompact} tnum !w-[68px] shrink-0 !px-2`}
                  />
                ) : null}

                <div className="w-[100px] shrink-0">
                  <PickList
                    compact
                    label={`材料${index + 1}の単位`}
                    value={item.unit}
                    onChange={(next) => patch(index, { unit: next as DrinkUnit })}
                    options={DRINK_UNITS.map((unit) => ({ id: unit, label: unit }))}
                  />
                </div>

                <button
                  type="button"
                  aria-label={`材料${index + 1}を消す`}
                  onClick={withTapFeedback(() =>
                    setItems((all) =>
                      all.length > 1 ? all.filter((_, i) => i !== index) : [emptyItem()]
                    )
                  )}
                  className="inline-flex h-8 w-6 shrink-0 items-center justify-center rounded-lg text-fg-mute transition-colors hover:text-danger"
                >
                  <IconClose size={13} />
                </button>
              </div>
            ))}
          </div>

          {items.length < MAX_ITEMS ? (
            <Button
              variant="outline"
              full
              className="mt-2"
              onClick={withTapFeedback(() => setItems((all) => [...all, emptyItem()]))}
            >
              <IconPlus size={14} />
              材料を足す
            </Button>
          ) : null}
        </Field>
      </div>
    </Sheet>
  )
}
