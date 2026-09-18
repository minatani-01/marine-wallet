import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_SAVING_RULES } from '@/lib/savings'
import { MEMBER_AVATAR_BUCKET, MEMBER_AVATAR_TTL_SECONDS } from '@/lib/constants'
import type {
  Game,
  LinkMonthlyCompare,
  LinkPermissionRow,
  LinkResource,
  LinkResourceFlags,
  MarineLinkRow,
  MarineLinkView,
  MonthlySaving,
  NotificationPreferences,
  Profile,
  SavingEntryRow,
  SavingCustomPreset,
  UpcomingMilestoneRow,
  SavingRules,
  SavingCircleTotal,
  SharedGoalMemberProgress,
  SharedGoalRow,
  SharedGoalView,
  SplitMember,
  SplitMemberView,
  SplitRecord,
  StadiumVisit,
  CircleMember,
  Place,
} from '@/types'

export const LINK_RESOURCES: LinkResource[] = ['saving', 'saving_rules', 'monthly', 'split']

function emptyFlags(): LinkResourceFlags {
  return { saving: false, saving_rules: false, monthly: false, split: false }
}

/**
 * サーバーコンポーネント用の読み取りヘルパー。
 * 書き込みはすべてクライアント側（RLS 経由）で行うため、ここには読み取りだけを置く。
 *
 * 重要: 取得に失敗したときに空配列やデフォルト値を返してはいけない。
 * 金額を扱う画面なので、「未精算 0円」のような “それらしいが誤った値” を
 * 表示するくらいなら、エラーを投げて error.tsx に再試行させる。
 */

/** テーブル名を持つ読み取りエラー。error.tsx でどの取得に失敗したか出すために使う */
export class QueryError extends Error {
  readonly table: string
  readonly code: string

  constructor(table: string, message: string, code = '') {
    super(`${table} の取得に失敗しました: ${message}`)
    this.name = 'QueryError'
    this.table = table
    this.code = code
  }
}

type SupabaseResult<T> = { data: T | null; error: { message: string; code?: string } | null }

const RETRY_DELAY_MS = 600

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 読み取りを実行し、失敗したら1回だけ再試行してから QueryError を投げる。
 *
 * Supabase の Free プランはアイドル後の初回アクセスでコールドスタートし、
 * ゲートウェイが 504 を返すことがある。読み取りは冪等なので、
 * ここで一度だけ引き直すとその大半を吸収できる。
 */
async function read<T>(table: string, run: () => PromiseLike<SupabaseResult<T>>): Promise<T | null> {
  let lastError: { message: string; code?: string } | null = null

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS)

    let result: SupabaseResult<T>
    try {
      result = await run()
    } catch (cause) {
      // fetch 自体が落ちたケース（DNS・接続断など）
      lastError = { message: cause instanceof Error ? cause.message : String(cause) }
      continue
    }

    if (!result.error) return result.data
    lastError = result.error
  }

  throw new QueryError(table, lastError?.message ?? 'unknown error', lastError?.code ?? '')
}

export type SessionUser = {
  id: string
  email: string
  /** ログインに使っている方法の表示名（'Google' / 'メールアドレス'） */
  signInMethod: string
}

/**
 * ログイン中のユーザー。layout と page の両方から呼ばれるので cache() で1回にまとめる。
 *
 * getUser() は毎回 Auth サーバーへ問い合わせる（実測 平均276ms）。
 * このプロジェクトの JWT は ES256 署名なので getClaims() ならローカル検証で済み、
 * JWKS を取得済みのインスタンスではネットワーク往復が発生しない。
 * ここで必要なのは id と email だけで、いずれも JWT のクレームに含まれる。
 */
/** OAuth プロバイダの表示名。増えたらここに足す */
const PROVIDER_LABEL: Record<string, string> = { google: 'Google' }

/**
 * 「どうやってログインしているか」を JWT から読む。
 *
 * app_metadata.provider は “アカウントを最初に作ったときの方法” なので、
 * あとから Google を紐付けた人は Google で入っていても 'email' のままになる。
 * そこで amr（このセッションで実際に使った認証方法）を先に見る。
 * amr が読めない場合だけ、紐付いているプロバイダから推測する。
 */
function signInMethodLabel(claims: Record<string, unknown>): string {
  const appMeta = claims.app_metadata as { provider?: unknown; providers?: unknown } | undefined
  const providers = Array.isArray(appMeta?.providers)
    ? appMeta.providers.filter((p): p is string => typeof p === 'string')
    : typeof appMeta?.provider === 'string'
      ? [appMeta.provider]
      : []
  const oauth = providers.find((p) => p !== 'email' && p !== 'phone')
  const oauthLabel = oauth ? (PROVIDER_LABEL[oauth] ?? oauth) : null

  const amr = Array.isArray(claims.amr) ? claims.amr : []
  const last = amr[amr.length - 1] as { method?: unknown } | undefined
  const method = typeof last?.method === 'string' ? last.method : null

  // メール/パスワード・マジックリンク・ワンタイムコードは、どれもメールでの認証
  if (method === 'password' || method === 'magiclink' || method === 'otp') return 'メールアドレス'
  return oauthLabel ?? 'メールアドレス'
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (error || !claims?.sub) return null
  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : '',
    signInMethod: signInMethodLabel(claims as unknown as Record<string, unknown>),
  }
})

export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = await createClient()
  return await read<Profile>('profiles', () =>
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  )
}

/**
 * どの通知を受け取るかの設定。
 *
 * 行が無い人は全部受け取る。あとから設定を足したときに、
 * 既に使っている人の通知が黙って止まらないようにするため。
 * 送信側（lib/push.ts）も同じ扱いにしてある。
 */
export async function getNotificationPreferences(
  userId: string
): Promise<NotificationPreferences> {
  const supabase = await createClient()
  const row = await read<NotificationPreferences>('notification_preferences', () =>
    supabase
      .from('notification_preferences')
      .select('games, savings, split, link')
      .eq('user_id', userId)
      .maybeSingle()
  )
  return row ?? { games: true, savings: true, split: true, link: true }
}

/**
 * 非公開バケットに置いた画像の署名付きURLを1件ぶん発行する。
 *
 * 失敗しても投げない。アイコンは飾りなので、頭文字表示に戻せば実害がない。
 * 金額の取得（read）と違い、欠けても “それらしい誤った値” にはならない。
 */
export async function signAvatarUrl(path: string | null): Promise<string | null> {
  if (!path) return null
  const supabase = await createClient()
  const { data } = await supabase.storage
    .from(MEMBER_AVATAR_BUCKET)
    .createSignedUrl(path, MEMBER_AVATAR_TTL_SECONDS)
  return data?.signedUrl ?? null
}

export async function getSavingRules(): Promise<SavingRules> {
  const supabase = await createClient()
  const data = await read<SavingRules>('saving_rule_settings', () =>
    supabase.from('saving_rule_settings').select('*').eq('id', true).maybeSingle()
  )

  // 行が無いのは想定外だが、既定値で動かせるので画面は止めない
  if (!data) return { ...DEFAULT_SAVING_RULES }

  // numeric 型は文字列で返るため数値に正規化する
  return {
    ...data,
    multiplier_regular: Number(data.multiplier_regular),
    multiplier_interleague: Number(data.multiplier_interleague),
    multiplier_cs: Number(data.multiplier_cs),
    multiplier_nippon_series: Number(data.multiplier_nippon_series),
  }
}

/**
 * カスタム登録の定型。全アカウント共通で、貯金ルールの画面から増やせる。
 */
/**
 * まもなく達成する記録。近いものから取る。
 *
 * 中身は毎朝の取り込みが作り直す。ここでは読むだけなので、
 * ページを開くたびに npb.jp の HTML を読み直すことはない。
 */
export async function getUpcomingMilestones(limit = 3): Promise<UpcomingMilestoneRow[]> {
  const supabase = await createClient()
  const data = await read<UpcomingMilestoneRow[]>('npb_upcoming_milestones', () =>
    supabase
      .from('npb_upcoming_milestones')
      .select('id, kind, record_label, holder, uniform_number, target, unit, current, remaining')
      .order('remaining', { ascending: true })
      .limit(limit)
  )
  return data ?? []
}

export async function getSavingCustomPresets(): Promise<SavingCustomPreset[]> {
  const supabase = await createClient()
  const data = await read<SavingCustomPreset[]>('saving_custom_presets', () =>
    supabase
      .from('saving_custom_presets')
      .select('id, label, amount, sort_order, auto')
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true })
  )
  return data ?? []
}

/**
 * 共通の貯金ルールを変更できるか。
 * マスター本人か、マスターが共有設定で「貯金ルール」をONにした相手だけ true。
 */
export async function canEditSavingRules(): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('can_edit_saving_rules')
  if (error) return false
  return data === true
}

export async function getSavingEntries(userId: string): Promise<SavingEntryRow[]> {
  const supabase = await createClient()
  const data = await read<SavingEntryRow[]>('saving_entries', () =>
    supabase
      .from('saving_entries')
      .select('*, game:games(*)')
      .eq('user_id', userId)
      .order('entry_date', { ascending: false })
  )

  // kind='custom' は game が null。自動登録なのに game が取れない行だけを除外する
  return (data ?? []).filter((entry) => entry.kind === 'custom' || Boolean(entry.game))
}

export async function getMonthlySavings(userId: string): Promise<MonthlySaving[]> {
  const supabase = await createClient()
  const data = await read<MonthlySaving[]>('monthly_savings', () =>
    supabase
      .from('monthly_savings')
      .select('*')
      .eq('user_id', userId)
      .order('month', { ascending: false })
  )
  return data ?? []
}

/**
 * 共有の割り勘の持ち主。
 *
 * 割り勘は「その場に居た全員の話」なので、輪で1つのデータを見る（0037）。
 * 持ち主はマスターで、割り勘の共有を許可された接続相手が読み書きする。
 * 許可されていない人には RLS が何も返さないので、その人は自分の分だけを見る。
 */
/**
 * 行った球場の記録（0038）。
 *
 * 人ごとの記録なので、自分のぶんを引く。接続相手のぶんは RLS が読ませるが、
 * スタンプ画面は自分の達成を見るところなので、ここでは絞る。
 */
export async function getStadiumVisits(userId: string): Promise<StadiumVisit[]> {
  const supabase = await createClient()
  const data = await read<StadiumVisit[]>('stadium_visits', () =>
    supabase
      .from('stadium_visits')
      .select('id, user_id, stadium_id, visited_on, game_id, note, companions, created_by')
      .eq('user_id', userId)
      .order('visited_on', { ascending: true })
  )
  return data ?? []
}

export async function getSplitOwnerId(fallback: string): Promise<string> {
  const supabase = await createClient()
  const data = await read<{ id: string }[]>('profiles', () =>
    supabase.from('profiles').select('id').eq('is_master', true).order('id').limit(1)
  )
  return data?.[0]?.id ?? fallback
}

export async function getSplitRecords(ownerId: string): Promise<SplitRecord[]> {
  const supabase = await createClient()
  const data = await read<SplitRecord[]>('records', () =>
    supabase
      .from('records')
      .select('*')
      .eq('user_id', ownerId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
  )
  return data ?? []
}

/**
 * 共有の割り勘のメンバー。
 *
 * 「あなた」が誰かは見る人によって変わるので、DB の is_self をそのまま使わない。
 * メンバーに登録された Marine ID と、見ている人の Marine ID を突き合わせる。
 * 突き合わない（Marine ID を入れていない）ときだけ、持ち主の is_self に戻す。
 */
export async function getSplitMembers(
  ownerId: string,
  viewerMarineId: string | null = null
): Promise<SplitMemberView[]> {
  const supabase = await createClient()
  const data = await read<SplitMember[]>('split_members', () =>
    supabase
      .from('split_members')
      .select('*')
      .eq('user_id', ownerId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
  )
  const key = (value: string | null) => (value ?? '').trim().toUpperCase()
  const mine = key(viewerMarineId)
  const matched = mine !== '' && (data ?? []).some((m) => key(m.marine_id) === mine)

  const members = (data ?? []).map((m) =>
    matched ? { ...m, is_self: key(m.marine_id) === mine } : m
  )

  // 写真は非公開バケットに置いてあるので、表示のたびに署名付きURLを発行する。
  // 1枚も無ければ Storage には触らない（写真を使っていない人にコストを増やさない）。
  const paths = members
    .map((m) => m.avatar_path)
    .filter((path): path is string => typeof path === 'string' && path !== '')

  if (paths.length === 0) {
    return members.map((m) => ({ ...m, avatar_url: null }))
  }

  // 署名に失敗しても投げない。写真は飾りなので、頭文字表示に戻せば実害がない。
  // 金額の取得（read）と違い、欠けても “それらしい誤った値” にはならない。
  const { data: signed } = await supabase.storage
    .from(MEMBER_AVATAR_BUCKET)
    .createSignedUrls(paths, MEMBER_AVATAR_TTL_SECONDS)

  const urls = new Map<string, string>()
  for (const row of signed ?? []) {
    if (row.path && row.signedUrl && !row.error) urls.set(row.path, row.signedUrl)
  }

  return members.map((m) => ({
    ...m,
    avatar_url: m.avatar_path ? (urls.get(m.avatar_path) ?? null) : null,
  }))
}

/** 直近の共通試合データ（貯金未登録の試合を拾うために使う） */
export async function getRecentGames(limit = 60): Promise<Game[]> {
  const supabase = await createClient()
  const data = await read<Game[]>('games', () =>
    supabase.from('games').select('*').order('game_date', { ascending: false }).limit(limit)
  )
  return data ?? []
}

// ------------------------------------------------ Marine Link (Phase 4) ----

/**
 * 自分が当事者の接続を、画面が扱いやすい形にして返す。
 *
 * RLS 側でも当事者以外は弾かれるが、意図を明示するためクエリでも絞る。
 * 相手のプロフィールは profiles_select_linked で読めるが、相手がまだ
 * プロフィール行を作っていないこともあるので name/marine_id は空を許容する。
 */
export async function getMarineLinks(userId: string): Promise<MarineLinkView[]> {
  const supabase = await createClient()

  const links = await read<MarineLinkRow[]>('marine_links', () =>
    supabase
      .from('marine_links')
      .select('*')
      .or(`user_a.eq.${userId},user_b.eq.${userId}`)
      .order('created_at', { ascending: false })
  )
  if (!links || links.length === 0) return []

  const linkIds = links.map((l) => l.id)
  const partnerIds = links.map((l) => (l.user_a === userId ? l.user_b : l.user_a))

  const [permissions, profiles] = await Promise.all([
    read<LinkPermissionRow[]>('link_permissions', () =>
      supabase.from('link_permissions').select('*').in('marine_link_id', linkIds)
    ),
    read<Profile[]>('profiles', () =>
      supabase.from('profiles').select('*').in('id', partnerIds)
    ),
  ])

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))

  return links.map((link) => {
    const partnerId = link.user_a === userId ? link.user_b : link.user_a
    const partner = profileById.get(partnerId)
    const shared = emptyFlags()
    const received = emptyFlags()

    for (const row of permissions ?? []) {
      if (row.marine_link_id !== link.id) continue
      if (row.owner_id === userId) shared[row.resource_type] = row.permission
      else if (row.owner_id === partnerId) received[row.resource_type] = row.permission
    }

    return {
      id: link.id,
      status: link.status,
      partner_id: partnerId,
      partner_name: partner?.display_name ?? '',
      partner_marine_id: partner?.marine_id ?? '',
      outgoing: link.requested_by === userId,
      shared,
      received,
      created_at: link.created_at,
    }
  })
}

/**
 * 仕様書 16章の月間比較。接続済みの相手について、当月の積立額を返す。
 *
 * 相手が貯金を共有していない場合、RLS で行が返らない。その状態を 0 円と
 * 区別できないと「相手は貯金していない」と誤読させるので、権限が無いことを
 * null で表す。
 *
 * 「ロッテ貯金を合算する」を切った相手は、そもそも一覧に出さない。
 */
export async function getLinkMonthlyCompare(
  links: MarineLinkView[],
  members: SplitMemberView[],
  month: string
): Promise<LinkMonthlyCompare[]> {
  // 「ロッテ貯金を合算する」を切った相手は、総累計だけでなく比較からも外す。
  // 自分の集計に入れないと決めた人が、別の場所に出てくると分かりにくい。
  // メンバー行が無い相手は合算する側に倒す（SQL の saving_circle_totals と同じ）。
  const mergedIn = (link: MarineLinkView) => {
    const member = members.find(
      (m) =>
        m.marine_id &&
        link.partner_marine_id &&
        m.marine_id.trim().toUpperCase() === link.partner_marine_id.trim().toUpperCase()
    )
    return member ? member.join_saving : true
  }

  const connected = links.filter((l) => l.status === 'accepted' && mergedIn(l))
  if (connected.length === 0) return []

  const visible = connected.filter((l) => l.received.saving)
  const amountByUser = new Map<string, number>()

  if (visible.length > 0) {
    const supabase = await createClient()
    const rows = await read<{ user_id: string; amount: number }[]>('saving_entries', () =>
      supabase
        .from('saving_entries')
        .select('user_id, amount')
        .in(
          'user_id',
          visible.map((l) => l.partner_id)
        )
        .eq('month', month)
    )
    for (const row of rows ?? []) {
      amountByUser.set(row.user_id, (amountByUser.get(row.user_id) ?? 0) + row.amount)
    }
  }

  return connected.map((link) => ({
    partner_id: link.partner_id,
    partner_name: link.partner_name,
    partner_amount: link.received.saving ? (amountByUser.get(link.partner_id) ?? 0) : null,
  }))
}

/** 指定月の自分の積立合計。月間比較のために全件取らずに済ませる */
export async function getMonthSavingTotal(userId: string, month: string): Promise<number> {
  const supabase = await createClient()
  const rows = await read<{ amount: number }[]>('saving_entries', () =>
    supabase.from('saving_entries').select('amount').eq('user_id', userId).eq('month', month)
  )
  return (rows ?? []).reduce((sum, row) => sum + row.amount, 0)
}


/**
 * 貯金の参加者ごとの累計（自分＋貯金に参加している接続済みメンバー）。
 *
 * 「累計貯金額」は月末に確定した月次金額の合計とする。今月のように
 * まだ確定していない月は累計に含めず、pending として別に返す。
 */
export async function getSavingCircleTotals(): Promise<SavingCircleTotal[]> {
  const supabase = await createClient()
  const rows = await read<SavingCircleTotal[]>('saving_circle_totals', () =>
    supabase.rpc('saving_circle_totals')
  )
  return (rows ?? []).map((row) => ({
    ...row,
    confirmed: Number(row.confirmed),
    pending: Number(row.pending),
  }))
}

/**
 * 共同目標と、その進捗（仕様書17章）。
 *
 * 目標そのものは RLS でメンバーだけが読める。進捗は shared_goal_progress() が
 * メンバーごとの合計だけを返す（相手の月次明細は読めない）。
 * 達成率は確定済みの合計で見る。未確定の見込みは別に持ち、合計には足さない。
 */
export async function getSharedGoals(): Promise<SharedGoalView[]> {
  const supabase = await createClient()

  const goals = await read<SharedGoalRow[]>('shared_goals', () =>
    supabase.from('shared_goals').select('*').order('created_at', { ascending: false })
  )
  if (!goals || goals.length === 0) return []

  const progresses = await Promise.all(
    goals.map((goal) =>
      read<SharedGoalMemberProgress[]>('shared_goal_progress', () =>
        supabase.rpc('shared_goal_progress', { p_goal_id: goal.id })
      )
    )
  )

  return goals.map((goal, index) => {
    const progress = (progresses[index] ?? []).map((row) => ({
      ...row,
      confirmed: Number(row.confirmed),
      pending: Number(row.pending),
    }))
    return {
      ...goal,
      progress,
      confirmed_total: progress.reduce((sum, row) => sum + row.confirmed, 0),
      pending_total: progress.reduce((sum, row) => sum + row.pending, 0),
    }
  })
}

/**
 * 行きたい場所・行った場所。全員で共有しているので、誰が入れたかで絞らない。
 * 行った側は新しい順、行きたい側は入れた順に並べたいので、両方の並びで取る。
 */
export async function getPlaces(): Promise<Place[]> {
  const supabase = await createClient()
  const data = await read<Place[]>('places', () =>
    supabase
      .from('places')
      .select('id, kind, name, area, url, note, stadium_id, visited_on, created_by, lat, lng')
      .order('visited_on', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: true })
  )
  return data ?? []
}

/**
 * 貯金を共にしている人の id と名前。同行者を選ぶのに使う。
 * 金額も連絡先も返さない（saving_circle_members）。
 */
export async function getCircleMembers(): Promise<CircleMember[]> {
  const supabase = await createClient()
  const rows = await read<CircleMember[]>('saving_circle_members', () =>
    supabase.rpc('saving_circle_members')
  )
  return rows ?? []
}

/** 指定した試合だけを引く。スタンプに点数を刻むときに使う */
export async function getGamesByIds(ids: string[]): Promise<Game[]> {
  if (ids.length === 0) return []
  const supabase = await createClient()
  const data = await read<Game[]>('games', () =>
    supabase.from('games').select('*').in('id', ids)
  )
  return data ?? []
}
