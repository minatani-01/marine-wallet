'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import Brand from '@/components/Brand'
import {
  IconArrowLeft,
  IconBell,
  IconClock,
  IconHome,
  IconMap,
  IconRefresh,
  IconUser,
  IconUsers,
  IconWallet,
} from '@/components/icons'

const TABS = [
  { href: '/', label: 'ホーム', Icon: IconHome },
  { href: '/savings', label: '貯金', Icon: IconWallet },
  { href: '/split', label: '割り勘', Icon: IconUsers },
  { href: '/places', label: 'マップ', Icon: IconMap },
  { href: '/history', label: '履歴', Icon: IconClock },
  { href: '/me', label: 'マイページ', Icon: IconUser },
]

/**
 * 更新ボタンに、その画面だけの仕事を足す仕組み。
 *
 * 更新ボタンはどの画面にもある。画面ごとに「ついでにやっておきたいこと」が
 * あるとき（マップなら種別・ジャンルの取り込み）、そのためのボタンを
 * 画面の中にもう1つ置くと、押す場所が増えるだけになる。
 * 画面側から登録してもらい、更新のときに先に走らせる。
 */
export type ReloadTask = {
  /** ボタンに出す説明。何が起きるかを押す前に分かるようにする */
  title: string
  run: () => Promise<void>
}

const ReloadTaskContext = createContext<(task: ReloadTask | null) => void>(() => {})

/**
 * 更新のときに走らせる仕事を登録する。
 *
 * title が null のあいだは何も登録しない（取り込むものが無いときなど）。
 * 画面を離れたら外す。
 */
export function useReloadTask(title: string | null, run: () => Promise<void>) {
  const set = useContext(ReloadTaskContext)
  // 中身は毎回変わってよい。登録し直すのは説明が変わったときだけにする
  const runRef = useRef(run)
  runRef.current = run

  useEffect(() => {
    if (!title) return
    set({ title, run: () => runRef.current() })
    return () => set(null)
  }, [set, title])
}

/** 各画面のヘッダー表示。タブ直下は中央タイトル、その下の階層は戻る矢印を出す */
const HEADERS: Record<string, { title: string; back?: string }> = {
  '/savings': { title: '貯金' },
  '/savings/rules': { title: '貯金ルール', back: '/savings' },
  '/split': { title: '割り勘' },
  '/history': { title: '履歴・グラフ' },
  '/stadiums': { title: '球場スタンプ', back: '/history' },
  '/places': { title: 'マップ' },
  '/places/genres': { title: 'ジャンルの設定', back: '/places' },
  '/me': { title: 'マイページ' },
  '/me/members': { title: 'メンバー', back: '/me' },
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const header = HEADERS[pathname]
  const [reloading, setReloading] = useState(false)

  // 画面から登録された、更新のついでにやる仕事
  const [task, setTask] = useState<ReloadTask | null>(null)

  /**
   * 更新。
   *
   * router.refresh() だとサーバーから取り直すのはデータだけで、
   * 配信されているアプリ自体は古いままになる。Marine Link の接続状況のような
   * 相手側の変化も、新しいビルドの取得も、まとめて拾えるように読み込み直す。
   *
   * 画面から仕事が登録されていれば、読み込み直す前に済ませる。終わってから
   * 読み込むので、取り込んだ結果がそのまま画面に出る。
   */
  const reload = async () => {
    setReloading(true)
    try {
      await task?.run()
    } catch {
      // 取り込めなくても読み込み直しは行う。押しても何も起きないより良い
    }
    window.location.reload()
  }

  return (
    <ReloadTaskContext.Provider value={setTask}>
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-ink/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
          <div className="grid h-14 grid-cols-[44px_1fr_44px] items-center px-2">
            <div className="flex justify-start">
              {header?.back ? (
                <button
                  type="button"
                  onClick={() => router.push(header.back!)}
                  aria-label="戻る"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-fg-dim transition-colors hover:text-marine"
                >
                  <IconArrowLeft size={20} />
                </button>
              ) : (
                // 戻る矢印が無い画面（各タブの先頭）では、同じ場所を更新に使う
                <button
                  type="button"
                  onClick={() => void reload()}
                  disabled={reloading}
                  aria-label={task ? `更新（${task.title}）` : '更新'}
                  title={
                    task ? `アプリとデータを最新にし、${task.title}` : 'アプリとデータを最新にする'
                  }
                  // 取り込むものがあるあいだは色を付ける。画面から案内の札を
                  // 外したので、ここが「やることが残っている」の合図になる
                  className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:text-marine disabled:opacity-50 ${
                    task ? 'text-marine' : 'text-fg-dim'
                  }`}
                >
                  <IconRefresh size={19} className={reloading ? 'animate-spin' : undefined} />
                </button>
              )}
            </div>

            <div className="flex min-w-0 justify-center overflow-hidden">
              {header ? (
                <span className="truncate text-[15px] font-semibold tracking-wide">
                  {header.title}
                </span>
              ) : (
                <Link href="/" prefetch={false} className="min-w-0">
                  <Brand />
                </Link>
              )}
            </div>

            <div className="flex justify-end">
              {header ? null : (
                <Link
                  href="/me#notifications"
                  prefetch={false}
                  aria-label="通知設定"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-fg-dim transition-colors hover:text-marine"
                >
                  <IconBell size={19} />
                </Link>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 pt-5 pb-[calc(7rem+env(safe-area-inset-bottom))]">
          {children}
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/92 backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-lg">
            {TABS.map(({ href, label, Icon }) => {
              const active = isActive(pathname, href)
              return (
                <Link
                  key={href}
                  href={href}
                  // 5タブが常に画面内にあるため、既定のプリフェッチだと1画面開くたびに
                  // 他4タブぶんの RSC がサーバーで丸ごと描画され、そのぶん Supabase への
                  // クエリも走る。5タブとも動的かつ個人データなので、先読みしても
                  // 使われないことが多い。タップ時に取りに行く方が総コストが小さい。
                  prefetch={false}
                  aria-current={active ? 'page' : undefined}
                  className={`flex flex-1 flex-col items-center gap-1 pt-2.5 pb-[max(10px,env(safe-area-inset-bottom))] transition-colors ${
                    active ? 'text-marine' : 'text-fg-mute hover:text-fg-dim'
                  }`}
                >
                  <Icon size={21} />
                  <span className="text-[10px] tracking-wide">{label}</span>
                </Link>
              )
            })}
          </div>
        </nav>
      </div>
    </ReloadTaskContext.Provider>
  )
}
