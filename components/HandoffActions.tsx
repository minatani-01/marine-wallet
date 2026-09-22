'use client'

import { useEffect, useRef, useState } from 'react'
import { IconCheck, IconCopy, IconExternal } from '@/components/icons'
import { APP_LINK_STORAGE_KEY, EXTERNAL_APPS, type ExternalAppKey } from '@/lib/constants'

export type AppLinks = Partial<Record<ExternalAppKey, string>>

/** この端末で上書きされた起動URLだけを返す（既定値は含まない） */
export function loadAppLinkOverrides(): AppLinks {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(APP_LINK_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as AppLinks) : {}
  } catch {
    return {}
  }
}

/**
 * 実際に使う起動URL。端末ごとの上書きがあればそれを、無ければ組み込みの既定値を返す。
 *
 * 既定値をコードに持たせているので、新しい端末でも設定なしでそのまま起動できる。
 * 端末によって最適なURLが違う場合（例: intent スキームは Android のみ）は
 * マイページで上書きする。
 */
/** この端末が Android かどうか。起動URLの形が変わる */
function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android/i.test(navigator.userAgent)
}

export function resolveAppUrl(app: ExternalAppKey): string {
  const override = loadAppLinkOverrides()[app]?.trim()
  if (override) return override

  const meta = EXTERNAL_APPS[app]
  return (isAndroid() && meta.androidUrl) || meta.defaultUrl
}

/** マイページの入力欄に出す値。上書きが無ければ既定値を見せる */
export function loadAppLinks(): AppLinks {
  const links: AppLinks = {}
  for (const key of Object.keys(EXTERNAL_APPS) as ExternalAppKey[]) {
    links[key] = resolveAppUrl(key)
  }
  return links
}

/**
 * 端末ごとの上書きを保存する。
 * 既定値と同じ値や空欄は保存せず、既定値に戻す（入力欄を空にすれば初期化になる）。
 */
export function saveAppLinks(links: AppLinks) {
  const overrides: AppLinks = {}
  for (const key of Object.keys(EXTERNAL_APPS) as ExternalAppKey[]) {
    const value = links[key]?.trim()
    if (value && value !== EXTERNAL_APPS[key].defaultUrl) overrides[key] = value
  }
  try {
    window.localStorage.setItem(APP_LINK_STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    /* localStorage が使えない環境では上書きを保持しないだけで、既定値では動作する */
  }
}

/** 金額をクリップボードへコピーする。Marine Wallet 自身は送金しない（仕様書 11.2） */
export function CopyAmountButton({ amount, label }: { amount: number; label?: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    const text = String(Math.round(amount))
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // クリップボードAPIが使えない場合は選択用のプロンプトで代替する
      window.prompt('金額をコピーしてください', text)
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-line bg-white/[0.02] px-4 text-sm text-fg transition-colors hover:border-marine/60 hover:text-marine"
    >
      {copied ? <IconCheck size={17} /> : <IconCopy size={17} />}
      {copied ? 'コピーしました' : (label ?? '金額をコピー')}
    </button>
  )
}

/**
 * 外部アプリの起動。組み込みの既定URLがあるので、設定しなくても押せる。
 *
 * URL の解決は localStorage を読むためクライアント側でしか行えない。
 * サーバー描画時とハイドレーション直後は既定値を使い、
 * 端末の上書きがあればマウント後に差し替える。
 */
export function OpenAppButton({ app }: { app: ExternalAppKey }) {
  const meta = EXTERNAL_APPS[app]
  const [url, setUrl] = useState(meta.defaultUrl)

  useEffect(() => {
    setUrl(resolveAppUrl(app))
  }, [app])

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-marine px-4 text-sm font-semibold text-ink transition-colors hover:bg-teal"
    >
      <IconExternal size={17} />
      {meta.label}を開く
    </a>
  )
}

/**
 * ロゴだけの起動ボタン。
 *
 * 画像が無い環境では、文字だけの丸ボタンに落とす。ロゴは球団のもので、
 * リポジトリに置いていない端末・環境でも画面が崩れないようにする
 * （components/Brand.tsx と同じ考え方）。
 */
export function OpenAppMark({
  app,
  src,
  size = 44,
  fallback,
}: {
  app: ExternalAppKey
  /** ロゴ画像の場所。読み込めなければ fallback を出す */
  src: string
  size?: number
  /** 画像が無いときに出す短い文字 */
  fallback: string
}) {
  const meta = EXTERNAL_APPS[app]
  const [url, setUrl] = useState(meta.defaultUrl)
  const [loaded, setLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    setUrl(resolveAppUrl(app))
  }, [app])

  // SSR された img はハイドレーション前に読み込みが終わることがあり、
  // その場合 onLoad が発火しない。マウント時に完了済みかを確認する
  useEffect(() => {
    const img = imgRef.current
    if (img?.complete && img.naturalWidth > 0) setLoaded(true)
  }, [])

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={`${meta.label}を開く`}
      title={`${meta.label}を開く`}
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[22%] border border-line bg-white transition-opacity hover:opacity-80"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt=""
        width={size}
        height={size}
        className="h-full w-full object-contain"
        style={{ display: loaded ? 'block' : 'none' }}
        onLoad={() => setLoaded(true)}
      />
      {loaded ? null : (
        <span className="text-[11px] font-semibold text-ink">{fallback}</span>
      )}
    </a>
  )
}
