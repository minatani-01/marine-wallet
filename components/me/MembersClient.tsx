'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Amount,
  Button,
  Card,
  EmptyState,
  IconButton,
  SectionLabel,
  Sheet,
  Toggle,
  inputClass,
} from '@/components/ui'
import AvatarPicker from '@/components/AvatarPicker'
import SharedGoals from '@/components/me/SharedGoals'
import {
  IconCheck,
  IconClose,
  IconCopy,
  IconLink,
  IconPlus,
  IconTrash,
} from '@/components/icons'
import { createClient } from '@/lib/supabase/client'
import { notifyPartner } from '@/lib/notify-client'
import { rejectReason, removeAvatarFile, uploadAvatar } from '@/lib/avatar'
import { LINK_RESOURCE_META } from '@/lib/constants'
import { monthLabel } from '@/lib/format'
import type {
  LinkMonthlyCompare,
  LinkResource,
  MarineLinkView,
  SharedGoalView,
  SplitMemberView,
} from '@/types'

const MARINE_ID_PATTERN = /^MW-[0-9A-Z]{6}$/

const sameId = (a: string | null, b: string | null) =>
  Boolean(a && b) && a!.trim().toUpperCase() === b!.trim().toUpperCase()

/**
 * 一緒に使う人の管理（メンバー ＋ Marine Link）。
 *
 * もとは「メンバー」と「Marine Link」の2画面に分かれていたが、
 * どちらも同じ相手を Marine ID で指すため、同じ人を2か所に登録することになっていた。
 * 1人1行にまとめ、その行の中で 接続・共有・割り勘の参加までを完結させる。
 *
 * 割り勘はメンバー単位（Marine ID を登録した人が参加している記録だけが相手に見える）、
 * 貯金は接続単位（接続していれば合算）という違いは残る。仕様 Phase 4 の
 * 「貯金は共同、割り勘は別」に沿っているため、画面の側で説明する。
 */
export default function MembersClient({
  userId,
  ownerId,
  marineId,
  isMaster,
  members,
  links,
  month,
  myMonthTotal,
  compare,
  goals,
}: {
  userId: string
  /** 共有の割り勘・メンバーの持ち主。書き込みはこの人の持ち物として行う */
  ownerId: string
  /** 自分の Marine ID */
  marineId: string
  /** マスター権限。自分が送ったリクエストは承認を待たずに接続される */
  isMaster: boolean
  members: SplitMemberView[]
  links: MarineLinkView[]
  month: string
  myMonthTotal: number
  compare: LinkMonthlyCompare[]
  goals: SharedGoalView[]
}) {
  const router = useRouter()
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 編集中の Marine ID（メンバーID -> 入力値）。保存するまでDBには書かない
  const [draftIds, setDraftIds] = useState<Record<string, string>>({})
  const [savedId, setSavedId] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // シートの対象はメンバー。接続していない人にも開けるようにする。
  // 実体ではなく id で持ち、表示は members から引き直す。
  // 実体を握ると、トグルを切ったあとも古い値が残って見える。
  const [settingsMemberId, setSettingsMemberId] = useState<string | null>(null)
  const [permissionTarget, setPermissionTarget] = useState<MarineLinkView | null>(null)

  const connected = useMemo(() => links.filter((l) => l.status === 'accepted'), [links])
  const incoming = useMemo(
    () => links.filter((l) => l.status === 'pending' && !l.outgoing),
    [links]
  )

  /** メンバーに対応する接続。Marine ID で突き合わせる（DB側の判定と同じ規則） */
  const linkOf = (member: SplitMemberView) =>
    links.find((l) => sameId(l.partner_marine_id, member.marine_id)) ?? null

  /** どのメンバーにも紐づいていない接続。メンバーへ取り込めるように別枠で出す */
  const unlistedLinks = useMemo(
    () =>
      connected.filter(
        (l) => !members.some((m) => sameId(l.partner_marine_id, m.marine_id))
      ),
    [connected, members]
  )

  /**
   * Marine ID から相手のユーザーIDを引く。
   * 接続が無いうちは分からないので、そのときは通知を送らない。
   */
  const partnerIdOf = (marineId: string | null) =>
    links.find((l) => sameId(l.partner_marine_id, marineId))?.partner_id ?? null

  const settingsMember = members.find((m) => m.id === settingsMemberId) ?? null

  const openSettings = (member: SplitMemberView) => {
    setSettingsMemberId(member.id)
    setPermissionTarget(linkOf(member))
  }

  /** 共有の設定は、接続が承認されているときだけ意味を持つ */
  const connectedTarget = permissionTarget?.status === 'accepted' ? permissionTarget : null

  const closeSettings = () => {
    setSettingsMemberId(null)
    setPermissionTarget(null)
  }

  const draftOf = (member: SplitMemberView) => draftIds[member.id] ?? member.marine_id ?? ''

  const copyMarineId = async () => {
    if (!marineId) return
    try {
      await navigator.clipboard.writeText(marineId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      window.prompt('Marine ID', marineId)
    }
  }

  /**
   * その人を自分の画面に入れるかどうか。
   *
   * 共有設定（相手に自分のデータを見せるか）とは向きが違う。
   * こちらは「相手のデータを自分の集計に入れるか」なので、
   * 相手が公開していても、こちらで外せば入らない。
   *
   * 割り勘を外しても、過去の記録と精算額は変わらない。
   * 消えるのは、これから登録するときの候補と、メンバーの一覧だけ。
   */
  const setJoin = async (
    member: SplitMemberView,
    field: 'join_split' | 'join_saving',
    next: boolean
  ) => {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('split_members')
      .update({ [field]: next })
      .eq('id', member.id)
    setBusy(false)
    if (error) {
      setError('設定を保存できませんでした')
      return
    }
    router.refresh()
  }

  const saveMarineId = async (member: SplitMemberView) => {
    const raw = draftOf(member).trim().toUpperCase()
    // 空欄は「登録しない」。書式が違うものは DB の CHECK に弾かれる前にここで止める
    if (raw !== '' && !MARINE_ID_PATTERN.test(raw)) {
      setError('Marine ID は MW- に続く6文字で入力してください')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('split_members')
      .update({ marine_id: raw === '' ? null : raw })
      .eq('id', member.id)
    setBusy(false)
    if (error) {
      setError('Marine ID の保存に失敗しました')
      return
    }
    setSavedId(member.id)
    setTimeout(() => setSavedId((prev) => (prev === member.id ? null : prev)), 1800)
    router.refresh()
  }

  /** そのメンバーのアカウントへ接続をリクエストする */
  const connect = async (member: SplitMemberView) => {
    if (!member.marine_id) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.rpc('request_marine_link', {
      target_marine_id: member.marine_id,
    })
    setBusy(false)
    if (error) {
      // RPC 側で日本語のメッセージを投げているのでそのまま出す
      setError(error.message)
      return
    }
    // マスターからのリクエストはその場で成立するので、相手には接続された旨を送る。
    // それ以外は承認を待つ状態なので、リクエストが届いたことを知らせる
    const partnerId = partnerIdOf(member.marine_id)
    notifyPartner(isMaster ? 'link_accepted' : 'link_request', partnerId)
    router.refresh()
  }

  const respond = async (link: MarineLinkView, status: 'accepted' | 'rejected') => {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.from('marine_links').update({ status }).eq('id', link.id)
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    // 断ったことは知らせない。承認したときだけ相手に届ける
    if (status === 'accepted') notifyPartner('link_accepted', link.partner_id)
    router.refresh()
  }

  const disconnect = async (link: MarineLinkView, confirmText: string) => {
    if (!window.confirm(confirmText)) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.from('marine_links').delete().eq('id', link.id)
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    closeSettings()
    router.refresh()
  }

  const setPermission = async (link: MarineLinkView, resource: LinkResource, next: boolean) => {
    setError(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('link_permissions')
      .update({ permission: next })
      .eq('marine_link_id', link.id)
      .eq('owner_id', userId)
      .eq('resource_type', resource)
    if (error) {
      setError(error.message)
      return
    }
    // 画面の値はサーバーから取り直す。楽観更新にすると失敗時の戻しが要る
    setPermissionTarget((prev) =>
      prev && prev.id === link.id
        ? { ...prev, shared: { ...prev.shared, [resource]: next } }
        : prev
    )
    router.refresh()
  }

  /**
   * 写真を差し替える。
   *
   * 先に新しいファイルを上げてから split_members を書き換え、最後に古いファイルを消す。
   * この順なら途中で失敗しても、表示中の写真が消えた状態にはならない。
   */
  const uploadPhoto = async (member: SplitMemberView, file: File) => {
    const reason = rejectReason(file)
    if (reason) {
      setError(reason)
      return
    }

    setUploading(member.id)
    setBusy(true)
    setError(null)
    const supabase = createClient()
    try {
      const path = await uploadAvatar(supabase, userId, member.id, file)

      const { error: updateError } = await supabase
        .from('split_members')
        .update({ avatar_path: path })
        .eq('id', member.id)
      if (updateError) {
        // 参照されないファイルを残さない
        await removeAvatarFile(supabase, path)
        throw new Error('写真の保存に失敗しました')
      }

      await removeAvatarFile(supabase, member.avatar_path)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '写真の保存に失敗しました')
    } finally {
      setUploading(null)
      setBusy(false)
    }
  }

  const removePhoto = async (member: SplitMemberView) => {
    if (!member.avatar_path) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('split_members')
      .update({ avatar_path: null })
      .eq('id', member.id)
    if (error) {
      setBusy(false)
      setError('写真の削除に失敗しました')
      return
    }
    await removeAvatarFile(supabase, member.avatar_path)
    setBusy(false)
    router.refresh()
  }

  const add = async (name: string, marine: string | null = null) => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (members.some((m) => m.name === trimmed)) {
      setError('同じ名前のメンバーがすでにいます')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.from('split_members').insert({
      user_id: ownerId,
      name: trimmed,
      marine_id: marine,
      sort_order: members.length,
    })
    setBusy(false)
    if (error) {
      setError('追加に失敗しました')
      return
    }
    setNewName('')
    router.refresh()
  }

  /**
   * 「あなた」の印を付け替える。
   *
   * メンバーは全員で共有しているので（0037）、この印は Marine ID を
   * 入れていないメンバーのための控えになる。Marine ID が入っていれば、
   * 見ている人の Marine ID と突き合わせた結果が優先される。
   */
  const markSelf = async (member: SplitMemberView) => {
    setBusy(true)
    const supabase = createClient()
    // 「あなた」は1人だけ。まず全員を解除してから対象だけ立てる
    await supabase.from('split_members').update({ is_self: false }).eq('user_id', ownerId)
    if (!member.is_self) {
      await supabase.from('split_members').update({ is_self: true }).eq('id', member.id)
    }
    setBusy(false)
    router.refresh()
  }

  const remove = async (member: SplitMemberView) => {
    if (
      !window.confirm(
        `${member.name} を削除しますか？\n過去の記録に保存された名前と金額はそのまま残ります。\n接続そのものは解除されません。`
      )
    ) {
      return
    }
    setBusy(true)
    const supabase = createClient()
    await supabase.from('split_members').delete().eq('id', member.id)
    await removeAvatarFile(supabase, member.avatar_path)
    setBusy(false)
    router.refresh()
  }

  const partnerLabel = (link: MarineLinkView) =>
    link.partner_name.trim() || link.partner_marine_id || '相手'

  return (
    <div className="flex flex-col gap-6">
      {/* 自分の Marine ID。相手に伝えてもらうための入り口 */}
      <div>
        <SectionLabel>あなたの Marine ID</SectionLabel>
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="tnum text-2xl font-semibold tracking-[0.16em] text-marine">
                {marineId || '------'}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-fg-mute">
                このIDを相手に伝えると、相手から接続をリクエストしてもらえます。
              </p>
            </div>
            <button
              type="button"
              onClick={copyMarineId}
              disabled={!marineId}
              aria-label="Marine IDをコピー"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line text-fg-mute transition-colors hover:border-marine/50 hover:text-marine disabled:opacity-40"
            >
              {copied ? <IconCheck size={17} /> : <IconCopy size={17} />}
            </button>
          </div>
        </Card>
      </div>

      {/* 届いているリクエスト */}
      {incoming.length > 0 ? (
        <div>
          <SectionLabel>届いているリクエスト</SectionLabel>
          <div className="flex flex-col gap-2">
            {incoming.map((link) => (
              <Card key={link.id}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{partnerLabel(link)}</div>
                    <div className="tnum text-[11px] text-fg-mute">{link.partner_marine_id}</div>
                  </div>
                  <IconButton
                    label="承認"
                    onClick={() => respond(link, 'accepted')}
                    disabled={busy}
                    className="border-marine/60 text-marine"
                  >
                    <IconCheck size={16} />
                  </IconButton>
                  <IconButton
                    label="却下"
                    onClick={() => respond(link, 'rejected')}
                    disabled={busy}
                    className="hover:border-danger/50 hover:text-danger"
                  >
                    <IconClose size={16} />
                  </IconButton>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {/* メンバー。1人1行で、接続と共有までここで完結させる */}
      <div>
        <SectionLabel>メンバー</SectionLabel>
        {members.length === 0 ? (
          <EmptyState title="メンバーがいません" description="下のフォームから追加してください。" />
        ) : (
          <div className="flex flex-col gap-2">
            {members.map((member) => {
              const link = linkOf(member)
              const draft = draftOf(member)
              return (
                <Card key={member.id} className="!p-3">
                  <div className="flex items-center gap-3">
                    <AvatarPicker
                      name={member.name}
                      src={member.avatar_url}
                      hasPhoto={Boolean(member.avatar_path)}
                      selected={member.is_self}
                      disabled={busy}
                      onFile={(file) => uploadPhoto(member, file)}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{member.name}</div>
                      {uploading === member.id ? (
                        <div className="text-[11px] text-fg-mute">写真を保存しています</div>
                      ) : member.is_self ? (
                        <div className="text-[11px] text-marine">あなた</div>
                      ) : link?.status === 'accepted' ? (
                        <div className="text-[11px] text-teal">接続済み</div>
                      ) : link?.status === 'pending' ? (
                        <div className="text-[11px] text-warn">
                          {link.outgoing ? '承認待ち' : 'リクエストが届いています'}
                        </div>
                      ) : member.marine_id ? (
                        <div className="text-[11px] text-fg-mute">未接続</div>
                      ) : null}
                    </div>

                    <IconButton
                      label={member.is_self ? '「あなた」を解除' : '「あなた」に設定'}
                      onClick={() => markSelf(member)}
                      disabled={busy}
                      className={member.is_self ? 'border-marine/60 text-marine' : ''}
                    >
                      <IconCheck size={15} />
                    </IconButton>
                    <IconButton
                      label="削除"
                      onClick={() => remove(member)}
                      disabled={busy}
                      className="hover:border-danger/50 hover:text-danger"
                    >
                      <IconTrash size={15} />
                    </IconButton>
                  </div>

                  {member.is_self ? null : (
                    <div className="mt-2.5 border-t border-line pt-2.5">
                      {/* Marine ID と接続。相手がアプリを使っているときだけ意味を持つ */}
                      <div className="flex items-center gap-2">
                        <IconLink size={15} className="shrink-0 text-fg-mute" />
                        <input
                          type="text"
                          value={draft}
                          onChange={(e) => {
                            setDraftIds((prev) => ({
                              ...prev,
                              [member.id]: e.target.value.toUpperCase(),
                            }))
                            setError(null)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveMarineId(member)
                          }}
                          placeholder="Marine ID（未登録）"
                          autoCapitalize="characters"
                          spellCheck={false}
                          className={`${inputClass} tnum !py-1.5 text-[13px] tracking-[0.1em]`}
                        />
                        {draft !== (member.marine_id ?? '') ? (
                          <Button
                            onClick={() => saveMarineId(member)}
                            disabled={busy}
                            className="shrink-0 !min-h-[36px] !px-3 text-[12px]"
                          >
                            {savedId === member.id ? <IconCheck size={15} /> : '保存'}
                          </Button>
                        ) : member.marine_id && !link ? (
                          <Button
                            onClick={() => connect(member)}
                            disabled={busy}
                            variant="primary"
                            className="shrink-0 !min-h-[36px] !px-3 text-[12px]"
                          >
                            接続
                          </Button>
                        ) : (
                          // 接続していない人にも開く。割り勘に出すかどうかはここで決める
                          <Button
                            onClick={() => openSettings(member)}
                            disabled={busy}
                            className="shrink-0 !min-h-[36px] !px-3 text-[12px]"
                          >
                            {link?.status === 'accepted' ? '共有設定' : '設定'}
                          </Button>
                        )}
                      </div>

                      {member.avatar_path ? (
                        <div className="mt-2.5 flex">
                          <button
                            type="button"
                            onClick={() => removePhoto(member)}
                            disabled={busy}
                            className="ml-auto shrink-0 text-[11px] text-fg-mute transition-colors hover:text-danger disabled:opacity-40"
                          >
                            写真を削除
                          </button>
                        </div>
                      ) : null}

                      {!member.marine_id ? (
                        <p className="mt-1.5 text-[11px] leading-relaxed text-fg-mute">
                          Marine ID を登録して接続すると、割り勘の共有と貯金の合算ができます。
                        </p>
                      ) : null}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* メンバーに載っていない接続。取り込めるようにしておく */}
      {unlistedLinks.length > 0 ? (
        <div>
          <SectionLabel>メンバー未登録の接続</SectionLabel>
          <div className="flex flex-col gap-2">
            {unlistedLinks.map((link) => (
              <Card key={link.id}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{partnerLabel(link)}</div>
                    <div className="tnum text-[11px] text-fg-mute">{link.partner_marine_id}</div>
                  </div>
                  <Button
                    onClick={() => add(partnerLabel(link), link.partner_marine_id)}
                    disabled={busy}
                    className="shrink-0 !min-h-[36px] !px-3 text-[12px]"
                  >
                    <IconPlus size={15} />
                    メンバーに追加
                  </Button>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-fg-mute">
                  接続しているので貯金は合算されています。割り勘でも共有するには、
                  メンバーに追加してください。
                </p>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <SectionLabel>メンバーを追加</SectionLabel>
        <Card>
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add(newName)
              }}
              placeholder="名前"
              className={inputClass}
            />
            <Button onClick={() => add(newName)} disabled={busy || !newName.trim()} className="shrink-0">
              <IconPlus size={16} />
              追加
            </Button>
          </div>
          {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
        </Card>
      </div>

      {/* 共同貯金（仕様書 17章） */}
      <SharedGoals userId={userId} goals={goals} connected={connected} />

      {/* 月間比較（仕様書 16章） */}
      {compare.length > 0 ? (
        <div>
          <SectionLabel>{monthLabel(month)}の比較</SectionLabel>
          <Card>
            <div className="divide-hairline">
              <div className="flex items-center justify-between gap-3 py-2">
                <span className="text-[13px]">あなた</span>
                <Amount value={myMonthTotal} size="sm" tone="marine" />
              </div>
              {compare.map((row) => (
                <div key={row.partner_id} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate text-[13px]">{row.partner_name || '相手'}</span>
                  {row.partner_amount === null ? (
                    <span className="text-[12px] text-fg-mute">非共有</span>
                  ) : (
                    <Amount value={row.partner_amount} size="sm" />
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      <div>
        <SectionLabel>この画面について</SectionLabel>
        <Card>
          <p className="text-[13px] leading-relaxed text-fg-mute">
            Marine Wallet を一緒に使う人をここで管理します。人数の上限はありません。
            名前を変更・削除しても、過去の記録に保存された名前と負担額は変わりません。
            アイコンをタップすると写真を設定できます。
          </p>
          <p className="mt-2.5 text-[13px] leading-relaxed text-fg-mute">
            相手も Marine Wallet を使っているなら、Marine ID を登録して「接続」を押してください
            （相手が承認すると接続されます）。接続すると、割り勘の共有と貯金の合算ができます。
            {isMaster ? 'マスター権限のため、あなたが送ったリクエストは承認を待たずに接続されます。' : ''}
          </p>
          <p className="mt-2.5 text-[13px] leading-relaxed text-fg-mute">
            行の「設定」で、その人を割り勘に出すかどうかを選べます。接続している相手なら、
            何を相手に見せるかと、相手の貯金を自分の総累計に合算するかもここで選べます。
            相手から見えるのは、その人が参加している記録だけです
            （参加していない記録は見えません。相手が書き換えることもできません）。
          </p>
        </Card>
      </div>

      {/* 設定。接続していない人にも開く。共有の4項目は接続があるときだけ出す */}
      {settingsMember ? (
        <Sheet
          title={
            connectedTarget
              ? `${partnerLabel(connectedTarget)} との共有設定`
              : `${settingsMember.name} の設定`
          }
          onClose={closeSettings}
        >
          {connectedTarget ? (
            <>
              <p className="mb-4 text-[11px] leading-relaxed text-fg-mute">
                あなたのデータのうち、相手に見せるものを選びます。相手からは閲覧のみで、
                書き換えはできません。試合結果は全ユーザー共通のデータなので、常に共有されます。
              </p>

              <div className="divide-hairline">
                {LINK_RESOURCE_META.map((resource) => (
                  <Toggle
                    key={resource.id}
                    checked={connectedTarget.shared[resource.id]}
                    onChange={(next) => setPermission(connectedTarget, resource.id, next)}
                    label={resource.label}
                    hint={resource.hint}
                  />
                ))}
              </div>
            </>
          ) : null}

          <div className={connectedTarget ? 'mt-5 border-t border-line pt-4' : ''}>
            <p className="eyebrow mb-1">あなたの集計に入れるもの</p>
            <p className="mb-1 text-[11px] leading-relaxed text-fg-mute">
              {connectedTarget
                ? '上とは向きが違い、相手のデータを自分の画面に入れるかどうかです。相手が公開していても、ここを切れば合算されません。'
                : 'この人を自分の画面に入れるかどうかです。'}
            </p>
            <div className="divide-hairline">
              {connectedTarget ? (
                <Toggle
                  checked={settingsMember.join_saving}
                  onChange={(next) => setJoin(settingsMember, 'join_saving', next)}
                  disabled={busy}
                  label="ロッテ貯金を合算する"
                  hint="総累計貯金額と月間比較に、この人の分を入れる"
                />
              ) : null}
              <Toggle
                checked={settingsMember.join_split}
                onChange={(next) => setJoin(settingsMember, 'join_split', next)}
                disabled={busy}
                label="割り勘に参加する"
                hint="割り勘のメンバーと、登録するときの候補に出す"
              />
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-fg-mute">
              割り勘を外しても、過去の記録と精算額は変わりません。
              未精算が残っている人は、金額が見えなくならないように一覧へ出し続けます。
            </p>
          </div>

          {connectedTarget ? (
            <>
              <div className="mt-5 border-t border-line pt-4">
                <p className="eyebrow mb-2">相手があなたに公開しているもの</p>
                <div className="flex flex-wrap gap-1.5">
                  {LINK_RESOURCE_META.filter((r) => connectedTarget.received[r.id]).length === 0 ? (
                    <p className="text-[12px] text-fg-mute">なし</p>
                  ) : (
                    LINK_RESOURCE_META.filter((r) => connectedTarget.received[r.id]).map((r) => (
                      <span
                        key={r.id}
                        className="rounded-full border border-line px-2.5 py-1 text-[11px] text-fg-dim"
                      >
                        {r.label}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div className="mt-6">
                <Button
                  variant="danger"
                  full
                  disabled={busy}
                  onClick={() =>
                    disconnect(
                      connectedTarget,
                      `${partnerLabel(connectedTarget)} との接続を解除しますか？\n\n共有は双方向に停止します。再接続するには、もう一度リクエストと承認が必要です。\nメンバーそのものは残ります。`
                    )
                  }
                >
                  <IconTrash size={17} />
                  接続を解除
                </Button>
              </div>
            </>
          ) : (
            <p className="mt-5 border-t border-line pt-4 text-[11px] leading-relaxed text-fg-mute">
              まだ接続していません。Marine ID を登録して接続すると、
              自分のデータを相手に見せるかどうかと、相手の貯金を合算するかどうかを選べます。
            </p>
          )}
        </Sheet>
      ) : null}
    </div>
  )
}
