-- ============================================================================
-- Marine Wallet / 0100_google_todo
-- ----------------------------------------------------------------------------
-- タスクを Google ToDo（Tasks API）にも入れる。
--
-- ToDo リストはカレンダーと違って他のアカウントに共有できない。サービス
-- アカウントでは本人のリストに触れないので、本人に Google でつないでもらい、
-- その refresh token を預かる。
--
--   google_connections … 預かった token。ブラウザからは読めない（RLS を
--                        有効にしてポリシーを張らない）。サーバーの
--                        service role だけが読み書きする
--   task_todo_settings … どのリストに入れるか・ON/OFF。本人が画面で選ぶ
--   tasks              … ToDo 側の ID と同期の記録を足す
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

create table if not exists public.google_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  /** つないだ Google アカウント。画面に「〜としてつないでいます」と出すため */
  email text not null default '',
  refresh_token text not null,
  scopes text not null default '',
  /** 最後に起きたこと。token が失効したときなど。空なら問題なし */
  error text not null default '',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.google_connections is
  'Google ToDo 用に預かった refresh token。service role だけが触る（0100）';

alter table public.google_connections enable row level security;
-- ポリシーは張らない。authenticated からは読めも書けもしない

create table if not exists public.task_todo_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  /** 入れる先の ToDo リスト。'@default' は既定のリスト */
  tasklist_id text not null default '@default',
  tasklist_title text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.task_todo_settings is 'タスクを入れる Google ToDo のリスト（0100）';

alter table public.task_todo_settings enable row level security;

drop policy if exists task_todo_settings_select_own on public.task_todo_settings;
create policy task_todo_settings_select_own on public.task_todo_settings
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists task_todo_settings_insert_own on public.task_todo_settings;
create policy task_todo_settings_insert_own on public.task_todo_settings
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists task_todo_settings_update_own on public.task_todo_settings;
create policy task_todo_settings_update_own on public.task_todo_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists task_todo_settings_delete_own on public.task_todo_settings;
create policy task_todo_settings_delete_own on public.task_todo_settings
  for delete to authenticated using (user_id = (select auth.uid()));

alter table public.tasks add column if not exists gtask_id text;
alter table public.tasks add column if not exists gtask_synced_at timestamptz;
alter table public.tasks add column if not exists gtask_error text not null default '';

comment on column public.tasks.gtask_id is 'Google ToDo 側のタスク ID（0100）';
