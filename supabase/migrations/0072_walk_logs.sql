-- ============================================================================
-- Marine Wallet / 0072_walk_logs
-- ----------------------------------------------------------------------------
-- 散歩の記録（からだの画面）。
--
-- ワークアウトやフリーウェイトと違い、負荷を上げていくものではない。
-- 続いているかどうかだけが分かればよいので、持つのは日付と歩いた時間、
-- それに距離と歩数（分かるときだけ）にとどめる。
--
-- サウナ（0064）と同じく、こちらから次回の目標を出すことはしない。
-- 散歩に「前回より長く」と言われると、続けるための行為ではなくなる。
--
-- 1日に何度でも入れられる。朝と夕方に別々に歩く日がある。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

create table if not exists public.walk_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  /** 歩いた時間（分） */
  minutes integer not null default 0,
  /** 距離（km）。測っていない日もあるので null を許す */
  distance_km numeric(5, 2),
  /** 歩数。測っていない日もあるので null を許す */
  steps integer,
  note text not null default '',
  created_at timestamptz not null default now()
);

comment on table public.walk_logs is
  '散歩の記録。続いているかどうかだけを見る（0072）';
comment on column public.walk_logs.distance_km is
  '距離（km）。測っていない日は null';
comment on column public.walk_logs.steps is
  '歩数。測っていない日は null';

create index if not exists walk_logs_user_date_idx
  on public.walk_logs (user_id, date desc);

alter table public.walk_logs enable row level security;

-- ----------------------------------------------------------------------------
-- 見え方。自分の行だけを扱える
-- ----------------------------------------------------------------------------
drop policy if exists walk_logs_select_own on public.walk_logs;
create policy walk_logs_select_own on public.walk_logs
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists walk_logs_insert_own on public.walk_logs;
create policy walk_logs_insert_own on public.walk_logs
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists walk_logs_update_own on public.walk_logs;
create policy walk_logs_update_own on public.walk_logs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists walk_logs_delete_own on public.walk_logs;
create policy walk_logs_delete_own on public.walk_logs
  for delete to authenticated using (user_id = (select auth.uid()));
