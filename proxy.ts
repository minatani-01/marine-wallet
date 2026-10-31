import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * 認証ガード。全リクエストを通るので、ここのコストがそのまま体感速度になる。
 *
 * getUser() は JWT を毎回 Auth サーバーへ問い合わせて検証するため、
 * 1リクエストにつき Supabase への往復が1回増える（実測 平均276ms）。
 * このプロジェクトの JWT は非対称鍵（ES256）で署名されているので、
 * getClaims() なら JWKS を初回だけ取得して以降はローカルで署名検証できる。
 * JWKS はモジュールスコープにキャッシュされるため、暖まったインスタンスでは往復ゼロになる。
 *
 * トレードオフ: getClaims() は exp まで JWT を信用するので、
 * セッションを失効させた直後の1リクエストは通り得る。画面の出し分けの話で、
 * データ自体は RLS が守るため、ここではローカル検証を選ぶ。
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value)
          )
        },
      },
    }
  )

  // 期限切れトークンの更新は getClaims() 内の getSession() が行うため、
  // ここを getClaims() にしてもリフレッシュの流れは変わらない。
  const { data } = await supabase.auth.getClaims()
  const signedIn = Boolean(data?.claims?.sub)

  const { pathname } = request.nextUrl

  // 未ログインでも通すパス。
  // /auth/callback は OAuth から ?code= 付きで戻ってくる地点で、
  // この時点ではまだセッションが無い。ここを弾くと code を交換できず、
  // Google ログインが必ず失敗する。
  //
  // /api/cron/* は Vercel Cron から呼ばれる。呼び出し元にブラウザはおらず
  // セッションも無いので、ここで弾くとログイン画面へ飛ばされて実行できない。
  // 代わりに Route Handler 側で CRON_SECRET を確かめる。
  //
  // /manifest.webmanifest と /sw.js はブラウザがクッキー無しで取りに来る
  // （manifest の取得は既定で credentials を付けない）。ここを弾くと
  // ログイン中でも /login へ転送され、Chrome が「このアプリはインストール
  // できません」と言い、ホーム画面のショートカットも出ない（0101）。
  // どちらも中身は公開してよいもので、個人の値は入っていない。
  const isPublic =
    pathname === '/login' ||
    pathname === '/auth' ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/api/cron/') ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/sw.js'

  if (!signedIn && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (signedIn && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return supabaseResponse
}

export const config = {
  // 画像などの静的アセットは認証チェックの対象外にする。
  // 除外しないと未ログイン時に /icon.png や /brand/mark.png まで /login へリダイレクトされ、
  // ログイン画面のロゴが表示されなくなる。
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|avif)$).*)',
  ],
}
