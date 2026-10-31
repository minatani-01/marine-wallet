# タスク・ToDo（0099 / 0100）

仕事のやること、買い物、払うもの。期限と重要度を付けて並べ替え、タグで分ける。
「GoogleToDo」タグを付けたものは Google ToDo に、「Googleカレンダー」タグを付けた
期限ありのものは Google カレンダーの予定になる。
全員の機能。入口はマイページの「やること」。URL は `/tasks`。

## 作り

| 場所 | 役割 |
| --- | --- |
| `lib/tasks.ts` | 純関数。重要度・タグ・期限の見せ方・並べ替え・区切り・入力の検査・カレンダーの予定の中身 |
| `lib/google-calendar.ts` | サービスアカウントで Google カレンダーに入れる・直す・消す（サーバー専用） |
| `lib/google-tasks.ts` | 本人の OAuth で Google ToDo に入れる・直す・消す。token の預かりと取り直し（サーバー専用） |
| `app/api/google/todo/*` | ToDo の接続（connect → Google → callback）、切る、リスト一覧 |
| `app/(app)/tasks/page.tsx` + `components/tasks/TasksClient.tsx` | 一覧。数・1行で入れる欄・並べ方・タグの絞り込み・区切り付きの一覧・済み |
| `components/tasks/TaskSheet.tsx` | 足す・直す・消す |
| `components/tasks/TagSheet.tsx` | タグを足す・消す |
| `app/(app)/tasks/google/page.tsx` + `components/tasks/TaskGoogleClient.tsx` | Google ToDo・Google カレンダーとの接続（`/tasks/calendar` はここへ転送） |
| `app/api/tasks/sync/route.ts` | タスクと ToDo・カレンダーを合わせる（1件・全部・消す・済みを消す） |
| `app/api/tasks/calendar/route.ts` | つながるかを確かめる |
| `supabase/migrations/0099_tasks.sql` | `tasks` / `task_tags` / `task_calendars` |
| `supabase/migrations/0100_google_todo.sql` | `google_connections` / `task_todo_settings`、`tasks` に `gtask_*` |

## データ

- `tasks` … 1件ずつ。`due_on`（日、null で期限なし）・`due_time`（'HH:MM'、null で終日）・
  `priority`（1 高 / 2 中 / 3 低）・`tags`（名前の配列）・`done`・`gcal_event_id` ほか
- `task_tags` … その人のタグ。最初に開いたときに 買物・仕事・金融・その他・Googleカレンダー を
  入れる。足す・消すは自由。消すと付いていたタスクからも外れる（タスクは残る）
- `task_calendars` … 予定を入れる先のカレンダー ID と ON/OFF。1人1行
- `task_todo_settings` … ToDo を入れる先のリスト ID と ON/OFF。1人1行
- `google_connections` … ToDo 用に預かった refresh token とメール。**RLS を有効にしてポリシーを
  張っていない**ので、ブラウザからは読めない。サーバーの service role だけが触る

RLS は（google_connections 以外）どれも自分の行だけ。

## 画面の決めごと

- **重要度は色。** 高 = 赤、中 = 琥珀、低 = 青緑。行の左の丸がその色で、押すと済む。
- **タグは枠の色で見分ける。** 重要度の色と被らない色を登録順に割り当てる。
  「Googleカレンダー」だけ水色で固定（分類ではなく「外に出す」印なので）。
- **並べ方は 期限 / 重要度 / 追加順。** 期限順は「期限切れ・今日・明日・今週・あとで・期限なし」で
  区切る。同じ日の中は時刻 → 重要度。重要度順は「高・中・低」で区切り、同じ重さの中は期限。
  選んだ並べ方は端末に覚える（localStorage）。
- **絞り込みはタグ。** 絞っている間に上の欄から入れると、そのタグが付く。
- **1行で入れられる。** 題名だけで入る（重要度 中・期限なし）。詳しくは行を押して直す。
- **済みは畳む。** 消すのは「済みを消す」を押したときだけ。

## Google ToDo（0100）

### 仕組み

ToDo リストはカレンダーと違って他のアカウントに共有できないので、サービスアカウントでは
本人のリストに触れない。本人に Google でつないでもらい（OAuth、scope は
`https://www.googleapis.com/auth/tasks`）、refresh token を預かる。

同意画面を **「本番」** にしておくこと。「テスト」のままだと refresh token が 7 日で切れる。
未審査でも動くが、つなぐときに「このアプリは Google で確認されていません」の警告が出る
（「詳細」→「Marine Wallet（安全ではないページ）に移動」で進める）。利用者は 100 人まで。

### 動き

- 「GoogleToDo」タグ → 保存のたびに ToDo を入れる・直す。**期限が無くても入る**
  - 期限は日付だけ（Tasks API は時刻を捨てる）。時刻と重要度はメモに書く
  - 入れる先のリストは設定で選ぶ。既定は「@default」（マイタスク）
- 済ませる → status を completed に。戻すと needsAction に戻し completed を消す
- タグを外す → ToDo を消す。タスクを消す → ToDo を消してから行を消す
- token が失効（invalid_grant）したら `google_connections.error` に残し、設定画面に
  「つなぎ直す」を出す

### 必要な設定（1回だけ）

1. Google Cloud Console（marine-wallet プロジェクト）
   - APIs & Services → ライブラリ → **Google Tasks API** を有効にする
   - OAuth 同意画面 → スコープに `.../auth/tasks` を足す → 公開ステータスを **本番** にする
   - 認証情報 → OAuth クライアント「Marine Wallet Web」→ 承認済みのリダイレクト URI に
     `https://marine-wallet.vercel.app/api/google/todo/callback` を足す
     （Supabase 用の URI はそのまま残す）
2. Vercel → Settings → Environment Variables（Production）
   - `GOOGLE_OAUTH_CLIENT_ID` … そのクライアントの ID
   - `GOOGLE_OAUTH_CLIENT_SECRET` … そのクライアントのシークレット
   - `SUPABASE_SERVICE_ROLE_KEY` はすでにある（token の預かりに使う）
   - 入れたら再デプロイ
3. 使う人それぞれ: `/tasks/google` の「Google でつなぐ」→ Google の画面で ToDo の権限に
   チェック → 戻ってきたら「リストを選ぶ」→ 保存

## Google カレンダー

### 仕組み

サービスアカウントで入る。使う人は自分のカレンダーをそのアドレスに「予定の変更」権限で
共有し、カレンダー ID をアプリの設定画面に貼る。

OAuth で本人の権限を借りる形にしなかったのは、同意画面を「テスト」のまま使うとトークンが
7日で切れて毎週ログインし直しになるため。公開して審査を通すほどのアプリでもない。
サービスアカウントなら鍵が有効なあいだ切れない。

### 動き

- 「Googleカレンダー」タグ + 期限あり → 保存のたびに予定を入れる・直す
  - 時刻あり … その時刻から 1 時間の予定
  - 時刻なし … 終日の予定
  - 説明にメモ・重要度・「Marine Wallet のタスク」を入れる
- 済ませる → 予定の頭に「済 」を付ける（消さない）
- タグを外す・期限を外す → 予定を消す
- タスクを消す → 予定を消してから行を消す
- 失敗したときは行の `gcal_error` に理由を残し、一覧に「予定に入っていません」と出す
- 設定画面の「全部合わせる」で、つなぐ前に付けたぶんをまとめて入れ直せる

### 必要な設定（1回だけ）

1. Google Cloud Console（プロジェクト marine-wallet）
   - APIs & Services → ライブラリ → **Google Calendar API** を有効にする
   - IAM と管理 → **サービス アカウント** → 作成（名前は marine-wallet-calendar など。役割は不要）
   - 作ったアカウント → キー → 鍵を追加 → JSON。ダウンロードした JSON から
     `client_email` と `private_key` を控える
2. Vercel → Settings → Environment Variables（Production）
   - `GOOGLE_SA_CLIENT_EMAIL` … `client_email` の値
   - `GOOGLE_SA_PRIVATE_KEY` … `private_key` の値（`-----BEGIN PRIVATE KEY-----` から
     `-----END PRIVATE KEY-----` まで。改行は `\n` のままでよい）
   - 入れたら再デプロイ
3. 使う人それぞれ（アプリの `/tasks/calendar` に手順が出る）
   - Google カレンダーの「設定と共有」で、サービスアカウントのアドレスを
     **「予定の変更」** の権限で共有に足す
   - 「カレンダーの統合」の **カレンダー ID** をアプリに貼って保存
   - 「つながるか確かめる」で読めることを見る

JSON の鍵ファイルはリポジトリに入れない。環境変数にだけ置く。

## Android のホーム画面

Web アプリなので、一覧がそのまま出るウィジェットは作れない。代わりに manifest の
`shortcuts` に「タスク」を入れてある（`app/manifest.ts`）。Android の Chrome で
ホーム画面に追加したアプリのアイコンを**長押し**すると「タスク」が出る。それを
ホーム画面にドラッグすれば、1タップで一覧が開く。

一覧をホーム画面に出したくなったら、小さな Android アプリ（AppWidgetProvider）を別に作る
ことになる。そのときはこのアプリ側に、鍵付きで一覧を返す API を足す。

## 分かっていること・限界

- ToDo もカレンダーも一方通行。Google 側で直してもタスクには戻らない
- ToDo の期限は日付だけ。カレンダー側で予定を動かしても、タスクの期限は変わらない
- 時刻の長さは 1 時間で固定
- タグを消すと、付いていたタスクを 1 件ずつ更新する。数百件を越えるなら SQL でまとめたほうがよい
