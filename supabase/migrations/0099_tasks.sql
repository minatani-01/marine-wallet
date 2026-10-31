-- ============================================================================
-- Marine Wallet / 0099_tasks
-- ----------------------------------------------------------------------------
-- タスク・ToDo。
--
-- 仕事のやること、買い物、払うもの。頭の中に置いておくと忘れるし、
-- メモ帳に書くと埋もれる。期限と重さを付けて、並べ替えられる形で持つ。
--
-- 3つの表に分ける。
--   tasks          … 1件ずつ。期限は無くてもよい（due_on が null）
--   task_tags      … その人が使うタグ。買物・仕事・金融・その他など、
--                    自由に足せる。タスク側には名前の配列で持つ
--   task_calendars … Google カレンダーとの接続（カレンダー ID）。
--                    「Googleカレンダー」タグの付いた期限ありタスクを、
--                    サービスアカウント経由で予定として入れる
--
-- 全員が使う。RLS は自分の行だけ。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  note text not null default '',
  /** 期限の日。null なら期限なし */
  due_on date,
  /** 期限の時刻 'HH:MM'。null なら終日 */
  due_time text,
  /** 重要度。1 高 / 2 中 / 3 低 */
  priority smallint not null default 2 check (priority between 1 and 3),
  /** タグ名の配列。task_tags の name を指す。消えたタグは画面で落とす */
  tags text[] not null default '{}',
  done boolean not null default false,
  done_at timestamptz,
  /** Google カレンダー側の予定 ID。入れていなければ null */
  gcal_event_id text,
  gcal_synced_at timestamptz,
  /** 最後に同期で起きたこと。空なら問題なし */
  gcal_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tasks is 'タスク・ToDo（0099）';
comment on column public.tasks.priority is '1 高 / 2 中 / 3 低（0099）';
comment on column public.tasks.tags is 'タグ名の配列。task_tags.name（0099）';

create index if not exists tasks_user_idx
  on public.tasks (user_id, done, due_on);

alter table public.tasks enable row level security;

drop policy if exists tasks_select_own on public.tasks;
create policy tasks_select_own on public.tasks
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists tasks_insert_own on public.tasks;
create policy tasks_insert_own on public.tasks
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists tasks_update_own on public.tasks;
create policy tasks_update_own on public.tasks
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists tasks_delete_own on public.tasks;
create policy tasks_delete_own on public.tasks
  for delete to authenticated using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- タグ
-- ----------------------------------------------------------------------------
create table if not exists public.task_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  /** 並び順。小さいほど先 */
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.task_tags is 'タスクのタグ。人ごと（0099）';

create unique index if not exists task_tags_user_name_idx
  on public.task_tags (user_id, name);

alter table public.task_tags enable row level security;

drop policy if exists task_tags_select_own on public.task_tags;
create policy task_tags_select_own on public.task_tags
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists task_tags_insert_own on public.task_tags;
create policy task_tags_insert_own on public.task_tags
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists task_tags_update_own on public.task_tags;
create policy task_tags_update_own on public.task_tags
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists task_tags_delete_own on public.task_tags;
create policy task_tags_delete_own on public.task_tags
  for delete to authenticated using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Google カレンダーとの接続
-- ----------------------------------------------------------------------------
create table if not exists public.task_calendars (
  user_id uuid primary key references auth.users (id) on delete cascade,
  /** 予定を入れる先のカレンダー ID（xxx@group.calendar.google.com / Gmail アドレス） */
  calendar_id text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.task_calendars is
  'タスクを入れる Google カレンダー。サービスアカウントに共有してもらう（0099）';

alter table public.task_calendars enable row level security;

drop policy if exists task_calendars_select_own on public.task_calendars;
create policy task_calendars_select_own on public.task_calendars
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists task_calendars_insert_own on public.task_calendars;
create policy task_calendars_insert_own on public.task_calendars
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists task_calendars_update_own on public.task_calendars;
create policy task_calendars_update_own on public.task_calendars
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists task_calendars_delete_own on public.task_calendars;
create policy task_calendars_delete_own on public.task_calendars
  for delete to authenticated using (user_id = (select auth.uid()));
