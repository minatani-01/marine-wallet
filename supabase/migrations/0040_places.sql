-- ============================================================================
-- Marine Wallet / 0040_places
-- ----------------------------------------------------------------------------
-- 行きたい場所と、行った場所。
--
-- 遠征は球場だけで終わらない。近くの観光地や店を「次はここ」と決めておき、
-- 行ったら消していく。思い付いたときに書き留める場所が無いと、
-- 出発してから思い出せない。
--
-- 2つの表は作らない。「行きたい」と「行った」は同じ場所の前後で、
-- 行ったときに書き写すと、行きたい側で書いたメモが失われる。
-- 行った日（visited_on）が入っているかどうかで分ける。
--
-- リストは全員で共有する。カスタム登録や割り勘と同じで、ここは
-- 「二人で行く場所」を決めるところなので、人によって中身が変わらない。
-- 誰でも足せる・直せる・消せる。
--
-- 球場（lib/stadiums.ts の id）を任意で結び付けられるようにする。
-- 「ZOZOマリンの近く」でまとめて見られると、遠征の計画がそのまま立つ。
--
-- 緯度経度は持たない。地図は Google マップへのリンクで開く。
-- 座標を持つと、店の移転で静かに嘘になるうえ、取得に鍵と課金が要る。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),

  /** 観光地（sight）か、飲食（food）か */
  kind text not null default 'sight',

  name text not null,

  /** 場所の手がかり。「幕張」「札幌駅前」など */
  area text not null default '',

  /** 公式サイトや食べログなど。空でもよい */
  url text not null default '',

  note text not null default '',

  /** 近い球場。lib/stadiums.ts の Stadium.id。結び付けなくてもよい */
  stadium_id text,

  /** 行った日。null なら「行きたい」側 */
  visited_on date,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.places enable row level security;

comment on table public.places is
  '行きたい場所と行った場所。visited_on の有無で分ける。全員で共有する';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'places_kind_check'
  ) then
    alter table public.places
      add constraint places_kind_check check (kind in ('sight', 'food'));
  end if;
end $$;

create index if not exists places_visited_idx on public.places (visited_on);
create index if not exists places_stadium_idx on public.places (stadium_id);

-- ----------------------------------------------------------------------------
-- 見え方
-- ----------------------------------------------------------------------------
-- 貯金を共にしている人なら誰でも読み書きできる。
create or replace function public.in_saving_circle()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) in (select public.saving_target_users());
$$;

revoke all on function public.in_saving_circle() from public, anon;
grant execute on function public.in_saving_circle() to authenticated;

drop policy if exists places_select on public.places;
create policy places_select on public.places
  for select to authenticated
  using (public.in_saving_circle());

drop policy if exists places_insert on public.places;
create policy places_insert on public.places
  for insert to authenticated
  with check (public.in_saving_circle());

drop policy if exists places_update on public.places;
create policy places_update on public.places
  for update to authenticated
  using (public.in_saving_circle())
  with check (public.in_saving_circle());

drop policy if exists places_delete on public.places;
create policy places_delete on public.places
  for delete to authenticated
  using (public.in_saving_circle());

drop trigger if exists places_touch_updated_at on public.places;
create trigger places_touch_updated_at
before update on public.places
for each row execute function public.touch_updated_at();
