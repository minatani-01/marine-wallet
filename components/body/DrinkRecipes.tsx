'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { IconPlus, IconTrash } from '@/components/icons'
import { Button, Card, EmptyState, Field, Sheet, inputClass } from '@/components/ui'
import { withTapFeedback } from '@/lib/haptics'
import { ingredientLines, rejectRecipeReason } from '@/lib/drinks'
import { createClient } from '@/lib/supabase/client'
import type { DrinkRecipe } from '@/types'

/**
 * 特製ドリンクのレシピ（0069）。
 *
 * 断食の前後や運動のあとに作るものが決まってくる。そのたびに思い出すのでは
 * 分量が毎回ぶれるし、良かった配合を忘れる。書いて残しておく。
 *
 * オートファジーの下に置く。食べない時間と地続きの話なので、作るときに
 * 画面を移らずに済む。
 *
 * 材料は1行1つの文字列で持つ。「プロテイン 30g」のように量まで含めて
 * 書けるようにしたいので、名前と量に分けない。分けると、粉・液体・個数で
 * 単位が割れて、どれにも当てはまらない書き方が出てくる。
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
 * 材料はたたまずに全部出す。作っている最中に開き直すことになるのでは、
 * 置いておく意味が薄い。
 */
function RecipeCard({ recipe, onEdit }: { recipe: DrinkRecipe; onEdit: () => void }) {
  const lines = ingredientLines(recipe.ingredients)

  return (
    <Card className="!p-0">
      <button
        type="button"
        onClick={withTapFeedback(onEdit)}
        aria-label={`${recipe.name}を編集`}
        className="w-full p-3.5 text-left transition-colors hover:bg-white/[0.03]"
      >
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate text-[14px] font-semibold">{recipe.name}</span>
          {recipe.timing ? (
            <span className="shrink-0 rounded-full border border-marine/40 bg-marine/10 px-2 py-0.5 text-[10px] text-marine">
              {recipe.timing}
            </span>
          ) : null}
        </div>

        {lines.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1">
            {lines.map((line, index) => (
              <li
                key={`${line}-${index}`}
                className="flex items-baseline gap-2 text-[12px] text-fg-dim"
              >
                <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-teal" />
                <span className="min-w-0">{line}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {recipe.note ? (
          <p className="mt-2 border-t border-line-soft pt-2 text-[11px] leading-relaxed text-fg-mute">
            {recipe.note}
          </p>
        ) : null}
      </button>
    </Card>
  )
}

/**
 * 足す・直す。
 *
 * 消すのもここに置く。一覧に消すボタンを並べると、材料を読みに来ただけの
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
  const [timing, setTiming] = useState(recipe?.timing ?? '')
  const [ingredients, setIngredients] = useState(recipe?.ingredients ?? '')
  const [note, setNote] = useState(recipe?.note ?? '')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const reason = rejectRecipeReason({ name, ingredients })
    if (reason) {
      setError(reason)
      return
    }

    setSaving(true)
    setError(null)
    const supabase = createClient()

    const payload = {
      user_id: userId,
      name: name.trim(),
      timing: timing.trim(),
      ingredients: ingredientLines(ingredients).join('\n'),
      note: note.trim(),
    }

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

        <Field label="いつ飲むか" hint="任意">
          <input
            type="text"
            value={timing}
            aria-label="いつ飲むか"
            onChange={(e) => setTiming(e.target.value)}
            placeholder="断食明け"
            className={inputClass}
          />
        </Field>

        {/* 1行1つ。量まで書いてもらう。名前と量に分けると、粉・液体・個数で
            単位が割れて、どれにも当てはまらない書き方が出てくる */}
        <Field label="材料" hint="1行に1つ。量も書く">
          <textarea
            value={ingredients}
            aria-label="材料"
            onChange={(e) => setIngredients(e.target.value)}
            rows={5}
            placeholder={'水 300ml\nプロテイン 30g\nレモン汁 小さじ1'}
            className={`${inputClass} resize-none`}
          />
        </Field>

        <Field label="作り方・メモ" hint="任意">
          <textarea
            value={note}
            aria-label="作り方・メモ"
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="シェイカーで30秒。氷は入れない"
            className={`${inputClass} resize-none`}
          />
        </Field>
      </div>
    </Sheet>
  )
}
