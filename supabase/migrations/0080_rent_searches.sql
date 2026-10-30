-- ============================================================================
-- Marine Wallet / 0080_rent_searches
-- ----------------------------------------------------------------------------
-- 賃貸さがしの、駅の組み合わせを保存する。
--
-- 駅を入れ直すのが手間になる。「新中野と中野坂上」「恵比寿と代官山」のように
-- いくつか候補を持って見比べるので、そのたびに1駅ずつ探し直すのでは続かない。
--
-- 端末の中（localStorage）には最後の1組だけを置いてある。こちらは名前を付けて
-- 何組でも残す。端末を変えても、キャッシュを消しても残るようにする。
--
-- 駅は jsonb でまとめて持つ。1駅1行にすると、並び順の列と、組を指す列が要る。
-- 組ごとに丸ごと読み書きするだけなので、分けても使い道が無い。
--
-- 自分の行だけを扱う。サブスク（0065）や賃貸さがしの画面と同じく master だけが
-- 使う機能だが、RLS は user_id で張る。画面で出さないことと、読めないことは別。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

create table if not exists public.rent_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  /** 組の名前。既定は駅名をつないだもの（例: 新中野駅・中野坂上駅） */
  name text not null,
  /**
   * 駅と、そこからの徒歩時間。
   * [{ "id": "s-1", "name": "新中野駅", "lat": 35.6, "lng": 139.6, "minutes": 10 }]
   */
  stations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.rent_searches is
  '賃貸さがしの、駅の組み合わせ（0080）';
comment on column public.rent_searches.stations is
  '駅と徒歩時間の配列。{id,name,lat,lng,minutes}（0080）';

-- 同じ名前を2つ作らない。押し間違えて同じ組が並ぶと、どれが新しいか分からない
create unique index if not exists rent_searches_user_name_idx
  on public.rent_searches (user_id, name);

create index if not exists rent_searches_user_idx
  on public.rent_searches (user_id, updated_at desc);

alter table public.rent_searches enable row level security;

-- ----------------------------------------------------------------------------
-- 見え方。自分の行だけを扱える
-- ----------------------------------------------------------------------------
drop policy if exists rent_searches_select_own on public.rent_searches;
create policy rent_searches_select_own on public.rent_searches
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists rent_searches_insert_own on public.rent_searches;
create policy rent_searches_insert_own on public.rent_searches
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists rent_searches_update_own on public.rent_searches;
create policy rent_searches_update_own on public.rent_searches
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists rent_searches_delete_own on public.rent_searches;
create policy rent_searches_delete_own on public.rent_searches
  for delete to authenticated using (user_id = (select auth.uid()));
