import { createSign } from 'node:crypto'

import type { EventBody } from '@/lib/tasks'

/**
 * Google カレンダーに予定を入れる（0099）。サーバー専用。
 *
 * サービスアカウントで入る。使う人は自分のカレンダーをこのアカウントの
 * アドレスに「予定の変更」権限で共有し、カレンダー ID をアプリに入れる。
 *
 * OAuth で本人の権限を借りる形にしなかったのは、同意画面を「テスト」の
 * まま使うとトークンが7日で切れて、毎週ログインし直しになるため。
 * サービスアカウントなら鍵が有効なあいだ切れない。2〜3人のアプリなので、
 * 共有の一手間のほうが軽い。
 *
 * 鍵は環境変数で渡す。JSON 丸ごとではなく、メールと秘密鍵の2つ。
 *   GOOGLE_SA_CLIENT_EMAIL … xxx@yyy.iam.gserviceaccount.com
 *   GOOGLE_SA_PRIVATE_KEY  … -----BEGIN PRIVATE KEY----- …（改行は \n でよい）
 */

const SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://www.googleapis.com/calendar/v3'

/** 1回の HTTP に待つ時間。カレンダー API は普段 1 秒かからない */
const TIMEOUT_MS = 10_000

export function serviceAccountEmail(): string | null {
  return process.env.GOOGLE_SA_CLIENT_EMAIL?.trim() || null
}

function privateKey(): string | null {
  const raw = process.env.GOOGLE_SA_PRIVATE_KEY
  if (!raw) return null
  // Vercel の入力欄に貼ると改行が \n の2文字になることがある
  return raw.replace(/\\n/g, '\n').trim() || null
}

export function isCalendarConfigured(): boolean {
  return Boolean(serviceAccountEmail() && privateKey())
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url')

/**
 * アクセストークン。
 *
 * サービスアカウントの JWT に署名して交換する。1時間有効なので、切れる
 * 少し前まではプロセスの中で使い回す。Vercel の関数は長生きしないが、
 * 同じ関数が続けて呼ばれたときの往復を1回減らせる。
 */
let cached: { token: string; until: number } | null = null

async function accessToken(): Promise<{ token: string } | { failed: string }> {
  const email = serviceAccountEmail()
  const key = privateKey()
  if (!email || !key) return { failed: 'サービスアカウントの鍵が設定されていません' }

  if (cached && cached.until > Date.now() + 60_000) return { token: cached.token }

  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })
  )
  let signature: string
  try {
    const signer = createSign('RSA-SHA256')
    signer.update(`${header}.${claims}`)
    signature = signer.sign(key, 'base64url')
  } catch {
    return { failed: '秘密鍵が読めません（GOOGLE_SA_PRIVATE_KEY の形を確かめてください）' }
  }

  let res: Response
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${header}.${claims}.${signature}`,
      }).toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    return { failed: `Google に届きません（${reason(e)}）` }
  }
  const body = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; error?: string; error_description?: string }
    | null
  if (!res.ok || !body?.access_token) {
    return { failed: `トークンを取れません（${body?.error_description ?? body?.error ?? `HTTP ${res.status}`}）` }
  }
  cached = { token: body.access_token, until: Date.now() + (body.expires_in ?? 3600) * 1000 }
  return { token: body.access_token }
}

function reason(e: unknown): string {
  if (!(e instanceof Error)) return '接続できず'
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return '時間切れ'
  const cause = (e as { cause?: unknown }).cause
  return (cause instanceof Error ? cause.message : e.message).slice(0, 80)
}

/** Google の失敗を1行にする。カレンダー API は { error: { message } } で返す */
async function failText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as
    | { error?: { message?: string; status?: string } }
    | null
  const detail = body?.error?.message ?? body?.error?.status ?? ''
  if (res.status === 404) return 'カレンダーが見つかりません（ID か共有を確かめてください）'
  if (res.status === 403) return `書き込めません（${detail || '共有の権限が「予定の変更」になっているか確かめてください'}）`
  return `HTTP ${res.status}${detail ? ` ${detail.slice(0, 120)}` : ''}`
}

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<{ res: Response } | { failed: string }> {
  const auth = await accessToken()
  if ('failed' in auth) return auth
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${auth.token}`,
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

export type UpsertResult = { ok: true; eventId: string } | { ok: false; reason: string }

/**
 * 予定を入れる・直す。
 *
 * 予定 ID を持っていれば PATCH。向こうで消されていて 404/410 なら、
 * 新しく作り直す。こちらの ID を信じすぎない。
 */
export async function upsertEvent(
  calendarId: string,
  eventId: string | null,
  body: EventBody
): Promise<UpsertResult> {
  if (eventId) {
    const r = await call('PATCH', `/calendars/${enc(calendarId)}/events/${enc(eventId)}`, body)
    if ('failed' in r) return { ok: false, reason: r.failed }
    if (r.res.ok) {
      const json = (await r.res.json().catch(() => null)) as { id?: string } | null
      return { ok: true, eventId: json?.id ?? eventId }
    }
    if (r.res.status !== 404 && r.res.status !== 410) {
      return { ok: false, reason: await failText(r.res) }
    }
  }
  const r = await call('POST', `/calendars/${enc(calendarId)}/events`, body)
  if ('failed' in r) return { ok: false, reason: r.failed }
  if (!r.res.ok) return { ok: false, reason: await failText(r.res) }
  const json = (await r.res.json().catch(() => null)) as { id?: string } | null
  if (!json?.id) return { ok: false, reason: '予定は入ったが ID が返りません' }
  return { ok: true, eventId: json.id }
}

/** 予定を消す。もう無ければ成功として扱う */
export async function deleteEvent(
  calendarId: string,
  eventId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const r = await call('DELETE', `/calendars/${enc(calendarId)}/events/${enc(eventId)}`)
  if ('failed' in r) return { ok: false, reason: r.failed }
  if (r.res.ok || r.res.status === 404 || r.res.status === 410) return { ok: true }
  return { ok: false, reason: await failText(r.res) }
}

/**
 * つながるかを確かめる。予定を1件だけ読んでみる。
 *
 * 読めれば ID と共有は合っている。書けるかどうかは権限の種類
 * （「閲覧」か「予定の変更」か）によるので、ここでは分からない。
 */
export async function probeCalendar(
  calendarId: string
): Promise<{ ok: true; summary: string } | { ok: false; reason: string }> {
  const r = await call('GET', `/calendars/${enc(calendarId)}/events?maxResults=1&fields=summary`)
  if ('failed' in r) return { ok: false, reason: r.failed }
  if (!r.res.ok) return { ok: false, reason: await failText(r.res) }
  const json = (await r.res.json().catch(() => null)) as { summary?: string } | null
  return { ok: true, summary: json?.summary ?? '' }
}
