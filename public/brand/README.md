# Brand assets

確定アイコン（M + ボール + 波のマーク）をここに置く。

| ファイル | 用途 | 推奨サイズ |
| --- | --- | --- |
| `mark.png` | ヘッダー・ログイン画面のロゴマーク | 512×512（透過PNG） |
| `marines.png` | ホーム右肩の MARINES APP 起動ボタン | 512×512（透過PNG） |

`marines.png` は球団のロゴなので、リポジトリには置かない前提でも壊れない。
無い場合は「公式」の文字ボタンになる（components/HandoffActions.tsx の OpenAppMark）。

アプリアイコン（ファビコン / ホーム画面追加）は Next.js の規約に従って
リポジトリ直下の `app/` に置く。

| ファイル | 用途 | 推奨サイズ |
| --- | --- | --- |
| `app/icon.png` | ファビコン | 512×512 |
| `app/apple-icon.png` | iOS ホーム画面 | 180×180 |

`public/brand/mark.png` が無い場合、`components/Brand.tsx` は読み込みエラーを検知して
ワードマーク（テキスト）のみを表示するため、画面は崩れない。
