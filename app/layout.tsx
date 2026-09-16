import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Marine Wallet',
  description:
    'マリーンズを応援する毎日を、記録し、つなぎ、未来へ積み立てる。貯金・割り勘・観戦記録を1つに統合する個人利用アプリ。',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#05070b',
  /**
   * iOS のホームバー・ノッチの下まで描く。
   *
   * これを入れないと env(safe-area-inset-*) が全て 0 になり、
   * 画面下のタブがホームバーと重なる。Android では余白が別に確保されるので
   * 気付きにくいが、iPhone では文字がホームバーに被る。
   *
   * 下まで描くぶん、ヘッダーとタブと各シートの端で inset を足し直す。
   */
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
