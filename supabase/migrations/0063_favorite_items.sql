-- ============================================================================
-- Marine Wallet / 0063_favorite_items
-- ----------------------------------------------------------------------------
-- お気に入りの品をジャンル別に持つ（RE:SELECT / /select）。
--
-- Google Apps Script の「RE:SELECT」をこちらへ移す。スプレッドシートを
-- 正本にするのをやめ、アプリの中で足せるようにする。
--
--   ジャンル / 商品名 / ブランド / 画像 / 価格 / メモ / ステータス /
--   購入先 / 購入URL / 表示順 / 有効
--
-- 画像は2つの入れ方を持つ。
--
--   image_path  favorites バケットに上げたもの。これから足すぶん
--   image_url   外から借りているURL。Drive に置いてある移行ぶん
--
-- 両方を持つのは、移行のときに画像だけ先に移せないため。Drive の画像は
-- バイト列を取り出せる経路が無く、アプリから入れ直すしかない。入れ直すまで
-- 表示が消えないよう、借りているURLも読めるようにしておく。
--
-- 自分の行だけを扱う。買うものは人それぞれで、二人で足し合わせる数字でも
-- ないので、オートファジー（0053）と同じく持ち主で絞る。同じ画面を開いても、
-- 出るのは自分が入れたものだけになる。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 表
-- ----------------------------------------------------------------------------
create table if not exists public.favorite_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  /** ジャンル。食品・美容 など。決め打ちにせず、書いたものが増える */
  genre text not null default 'その他',
  name text not null,
  brand text not null default '',
  /** favorites バケット上のパス。空なら image_url を見る */
  image_path text not null default '',
  /** 外から借りている画像URL。移行ぶんだけが持つ */
  image_url text not null default '',
  /** 円。分からないものもあるので null を許す */
  price integer,
  memo text not null default '',
  /** リピート / 欲しい */
  status text not null default '欲しい',
  shop_name text not null default '',
  shop_url text not null default '',
  /** 並び順。小さいほど先に出す */
  sort_order integer not null default 100,
  /** 外したものは false。消さずに残す */
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.favorite_items is
  'お気に入りの品。ジャンル別に並べる（0063）';
comment on column public.favorite_items.image_path is
  'favorites バケット上のパス。空なら image_url を見る';
comment on column public.favorite_items.image_url is
  '外から借りている画像URL。Drive から移したぶんだけが持つ';

create index if not exists favorite_items_user_idx
  on public.favorite_items (user_id, active, sort_order);

alter table public.favorite_items enable row level security;

-- ----------------------------------------------------------------------------
-- 2. 見え方。自分の行だけを扱える
-- ----------------------------------------------------------------------------
drop policy if exists favorite_items_select_own on public.favorite_items;
create policy favorite_items_select_own on public.favorite_items
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists favorite_items_insert_own on public.favorite_items;
create policy favorite_items_insert_own on public.favorite_items
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists favorite_items_update_own on public.favorite_items;
create policy favorite_items_update_own on public.favorite_items
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists favorite_items_delete_own on public.favorite_items;
create policy favorite_items_delete_own on public.favorite_items
  for delete to authenticated using (user_id = (select auth.uid()));

drop trigger if exists favorite_items_touch_updated_at on public.favorite_items;
create trigger favorite_items_touch_updated_at
  before update on public.favorite_items
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. 画像の置き場
-- ----------------------------------------------------------------------------
-- 非公開。見るときは署名付きURLを出す（領収書 0055 と同じ）
insert into storage.buckets (id, name, public)
values ('favorites', 'favorites', false)
on conflict (id) do nothing;

-- パスの先頭を user_id にして、その人のフォルダだけを触らせる
drop policy if exists "favorites_select_own" on storage.objects;
create policy "favorites_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'favorites'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "favorites_insert_own" on storage.objects;
create policy "favorites_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'favorites'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "favorites_update_own" on storage.objects;
create policy "favorites_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'favorites'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "favorites_delete_own" on storage.objects;
create policy "favorites_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'favorites'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
