import { createAdminClient } from '@/lib/supabase/admin'
import type { TodoBody } from '@/lib/tasks'
import type { GoogleConnectionView } from '@/types'

/**
 * Google ToDo（Tasks API）に入れる（0100）。サーバー専用。
 *
 * ToDo リストはカレンダーと違って他のアカウントに共有できない。サービス
 * アカウントでは本人のリストに触れないので、本人に Google でつないでもらい
 * （OAuth）、refresh token を預かって使う。
 *
 * token は google_connections に入れ、service role だけで読む。ブラウザには
 * 出さない。同意画面を「本番」にしておけば、token は使っているかぎり切れない
 * （「テスト」のままだと 7 日で切れる）。
 *
 * 環境変数:
 *   GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET … OAuth クライアント
 *   （Google ログインに使っている「Marine Wallet Web」をそのまま使える。
 *     リダイレクト URI に /api/google/todo/callback を足すこと）
 */

export const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const API = 'https://tasks.googleapis.com/tasks/v1'
const TIMEOUT_MS = 10_000

export function oauthClient(): { id: string; secret: string } | null {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  return id && secret ? { id, secret } : null
}

export function isTodoConfigured(): boolean {
  return oauthClient() !== null && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/** 認可画面の URL。offline + consent で refresh token を必ずもらう */
export function authorizeUrl(redirectUri: string, state: string): string | null {
  const client = oauthClient()
  if (!client) return null
  const q = new URLSearchParams({
    client_id: client.id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: `openid email ${TASKS_SCOPE}`,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_URL}?${q.toString()}`
}

function reason(e: unknown): string {
  if (!(e instanceof Error)) return '接続できず'
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return '時間切れ'
  const cause = (e as { cause?: unknown }).cause
  return (cause instanceof Error ? cause.message : e.message).slice(0, 80)
}

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  id_token?: string
  error?: string
  error_description?: string
}

async function postToken(form: Record<string, string>): Promise<TokenResponse | { failed: string }> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = (await res.json().catch(() => null)) as TokenResponse | null
    if (!body) return { failed: `HTTP ${res.status}` }
    if (!res.ok) return { failed: body.error_description ?? body.error ?? `HTTP ${res.status}` }
    return body
  } catch (e) {
    return { failed: `Google に届きません（${reason(e)}）` }
  }
}

/**
 * コールバックで code を token に替え、預かる。
 *
 * メールは userinfo から取る。画面に「〜としてつないでいます」と出すため。
 * refresh token が来なければ失敗にする（consent を付けているので普通は来る）。
 */
export async function connectWithCode(
  userId: string,
  code: string,
  redirectUri: string
): Promise<{ ok: true; email: string } | { ok: false; reason: string }> {
  const client = oauthClient()
  if (!client) return { ok: false, reason: 'OAuth クライアントが設定されていません' }

  const token = await postToken({
    code,
    client_id: client.id,
    client_secret: client.secret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
  if ('failed' in token) return { ok: false, reason: token.failed }
  if (!token.refresh_token) return { ok: false, reason: 'refresh token が返りませんでした。もう一度つないでください' }
  if (!(token.scope ?? '').includes(TASKS_SCOPE)) {
    return { ok: false, reason: 'ToDo の権限が許可されませんでした。チェックを入れてつなぎ直してください' }
  }

  let email = ''
  try {
    const res = await fetch(USERINFO_URL, {
      headers: { authorization: `Bearer ${token.access_token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const info = (await res.json().catch(() => null)) as { email?: string } | null
    email = info?.email ?? ''
  } catch {
    // メールが取れなくてもつなぐことはできる
  }

  const admin = createAdminClient()
  const { error } = await admin.from('google_connections').upsert(
    {
      user_id: userId,
      email,
      refresh_token: token.refresh_token,
      scopes: token.scope ?? '',
      error: '',
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )
  if (error) return { ok: false, reason: '預かれませんでした（DB）' }
  return { ok: true, email }
}

/** 画面に出すぶんだけ。token は返さない */
export async function getConnectionView(userId: string): Promise<GoogleConnectionView | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from('google_connections')
    .select('email, error, connected_at')
    .eq('user_id', userId)
    .maybeSingle<GoogleConnectionView>()
  return data ?? null
}

/** つながりを切る。Google 側でも取り消し、こちらの token も消す */
export async function disconnect(userId: string): Promise<void> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('google_connections')
    .select('refresh_token')
    .eq('user_id', userId)
    .maybeSingle<{ refresh_token: string }>()
  if (data?.refresh_token) {
    try {
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(data.refresh_token)}`, {
        method: 'POST',
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      // 取り消せなくても、こちらで捨てれば使えなくなる
    }
  }
  await admin.from('google_connections').delete().eq('user_id', userId)
}

/**
 * その人のアクセストークン。refresh token から毎回取り直す。
 *
 * 失効（invalid_grant）していたら、その旨を行に残す。画面はそれを見て
 * 「つなぎ直してください」と出す。
 */
const cache = new Map<string, { token: string; until: number }>()

export async function userAccessToken(
  userId: string
): Promise<{ token: string } | { failed: string; reconnect?: boolean }> {
  const client = oauthClient()
  if (!client) return { failed: 'OAuth クライアントが設定されていません' }

  const hit = cache.get(userId)
  if (hit && hit.until > Date.now() + 60_000) return { token: hit.token }

  const admin = createAdminClient()
  const { data } = await admin
    .from('google_connections')
    .select('refresh_token')
    .eq('user_id', userId)
    .maybeSingle<{ refresh_token: string }>()
  if (!data?.refresh_token) return { failed: 'Google ToDo をつないでいません', reconnect: true }

  const token = await postToken({
    refresh_token: data.refresh_token,
    client_id: client.id,
    client_secret: client.secret,
    grant_type: 'refresh_token',
  })
  if ('failed' in token || !token.access_token) {
    const why = 'failed' in token ? token.failed : 'トークンが返りません'
    await admin.from('google_connections').update({ error: why, updated_at: new Date().toISOString() }).eq('user_id', userId)
    return { failed: `つなぎ直しが必要です（${why}）`, reconnect: true }
  }
  cache.set(userId, { token: token.access_token, until: Date.now() + (token.expires_in ?? 3600) * 1000 })
  return { token: token.access_token }
}

async function failText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as
    | { error?: { message?: string; status?: string } }
    | null
  const detail = body?.error?.message ?? body?.error?.status ?? ''
  if (res.status === 404) return 'リストかタスクが見つかりません'
  if (res.status === 401 || res.status === 403) return `権限がありません（${detail || 'つなぎ直してください'}）`
  return `HTTP ${res.status}${detail ? ` ${detail.slice(0, 120)}` : ''}`
}

async function call(
  token: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<{ res: Response } | { failed: string }> {
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return { res }
  } catch (e) {
    return { failed: `Google に届きません（${reason(e)}）` }
  }
}

const enc = encodeURIComponent

export type TaskListView = { id: string; title: string }

export async function listTaskLists(
  token: string
): Promise<{ ok: true; lists: TaskListView[] } | { ok: false; reason: string }> {
  const r = await call(token, 'GET', '/users/@me/lists?maxResults=100')
  if ('failed' in r) return { ok: false, reason: r.failed }
  if (!r.res.ok) return { ok: false, reason: await failText(r.res) }
  const json = (await r.res.json().catch(() => null)) as { items?: TaskListView[] } | null
  return { ok: true, lists: (json?.items ?? []).map((l) => ({ id: l.id, title: l.title })) }
}

export type UpsertTodoResult = { ok: true; taskId: string } | { ok: false; reason: string }

/**
 * ToDo を入れる・直す。
 *
 * ID を持っていれば PATCH。向こうで消されていて 404 なら作り直す。
 * 戻すとき（needsAction）は completed を null で送って消す。
 */
export async function upsertTodo(
  token: string,
  listId: string,
  taskId: string | null,
  body: TodoBody
): Promise<UpsertTodoResult> {
  const payload: Record<string, unknown> = {
    title: body.title,
    notes: body.notes,
    status: body.status,
    due: body.due,
  }
  if (body.completed === null) payload.completed = null

  if (taskId) {
    const r = await call(token, 'PATCH', `/lists/${enc(listId)}/tasks/${enc(taskId)}`, payload)
    if ('failed' in r) return { ok: false, reason: r.failed }
    if (r.res.ok) {
      const json = (await r.res.json().catch(() => null)) as { id?: string } | null
      return { ok: true, taskId: json?.id ?? taskId }
    }
    if (r.res.status !== 404 && r.res.status !== 410) return { ok: false, reason: await failText(r.res) }
  }
  // 新しく作る。due に null は送れない
  if (payload.due === null) delete payload.due
  if ('completed' in payload) delete payload.completed
  const r = await call(token, 'POST', `/lists/${enc(listId)}/tasks`, payload)
  if ('failed' in r) return { ok: false, reason: r.failed }
  if (!r.res.ok) return { ok: false, reason: await failText(r.res) }
  const json = (await r.res.json().catch(() => null)) as { id?: string } | null
  if (!json?.id) return { ok: false, reason: 'ToDo は入ったが ID が返りません' }
  return { ok: true, taskId: json.id }
}

export async function deleteTodo(
  token: string,
  listId: string,
  taskId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const r = await call(token, 'DELETE', `/lists/${enc(listId)}/tasks/${enc(taskId)}`)
  if ('failed' in r) return { ok: false, reason: r.failed }
  if (r.res.ok || r.res.status === 404 || r.res.status === 410) return { ok: true }
  return { ok: false, reason: await failText(r.res) }
}
