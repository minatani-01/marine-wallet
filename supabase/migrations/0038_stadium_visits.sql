-- ============================================================================
-- Marine Wallet / 0038_stadium_visits
-- ----------------------------------------------------------------------------
-- 球場スタンプラリー。行った球場を記録する。
--
-- games.stadium は「マリーンズが試合をした球場」であって「自分が行った球場」
-- ではない。126試合ぶんの球場が入っているが、そのまま数えると行っていない
-- 球場にもスタンプが付く。行ったかどうかは本人しか知らないので、明示的に記録する。
--
-- 記録は人ごとにする。カスタム登録や割り勘と違い、ここは人によって本当に
-- 中身が変わる（「良旭は甲子園まで行った、良将はまだ」）。
--
-- 球場そのものは表を持たず、コード側のマスタ（lib/stadiums.ts）を指す。
-- 12球団の本拠地はめったに増えず、命名権が変わっても id は変わらない。
-- DBに置くと、名前が変わるたびにマイグレーションが要る。
--
-- 試合と結びつけられるようにしておく。ほとんどの来場は観戦なので、
-- 試合一覧から「行った」を押すだけで記録できるようにするため。
-- 試合の無い日に球場へ行くこともある（イベント・見学）ので、必須にはしない。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

create table if not exists public.stadium_visits (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users(id) on delete cascade,

  /** lib/stadiums.ts の Stadium.id。DBに球場表は持たない */
  stadium_id text not null,

  visited_on date not null,

  /** 観戦した試合。試合の無い日に行くこともあるので任意 */
  game_id uuid references public.games(id) on delete set null,

  note text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.stadium_visits enable row level security;

comment on table public.stadium_visits is
  '行った球場の記録。球場は lib/stadiums.ts のマスタを id で指す';

-- 同じ試合を二度チェックしない。試合に紐づかない来場は日付で分ける
create unique index if not exists stadium_visits_user_game_idx
  on public.stadium_visits (user_id, game_id)
  where game_id is not null;

create unique index if not exists stadium_visits_user_place_day_idx
  on public.stadium_visits (user_id, stadium_id, visited_on)
  where game_id is null;

create index if not exists stadium_visits_user_idx
  on public.stadium_visits (user_id, stadium_id);

-- ----------------------------------------------------------------------------
-- 見え方
-- ----------------------------------------------------------------------------
-- 自分の記録は読み書きできる。接続している相手のぶんは読むだけ。
-- 「良将はまだ甲子園に行っていない」が見えると、次の遠征の相談になる。
-- 貯金の共有（saving）を許可している相手に限る。割り勘と同じ考え方で、
-- 許可していない相手には見えない。
drop policy if exists stadium_visits_select_own on public.stadium_visits;
create policy stadium_visits_select_own on public.stadium_visits
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists stadium_visits_select_linked on public.stadium_visits;
create policy stadium_visits_select_linked on public.stadium_visits
  for select to authenticated
  using (
    user_id <> (select auth.uid())
    and public.marine_link_allows(user_id, 'saving')
  );

drop policy if exists stadium_visits_insert_own on public.stadium_visits;
create policy stadium_visits_insert_own on public.stadium_visits
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists stadium_visits_update_own on public.stadium_visits;
create policy stadium_visits_update_own on public.stadium_visits
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists stadium_visits_delete_own on public.stadium_visits;
create policy stadium_visits_delete_own on public.stadium_visits
  for delete to authenticated
  using (user_id = (select auth.uid()));

drop trigger if exists stadium_visits_touch_updated_at on public.stadium_visits;
create trigger stadium_visits_touch_updated_at
before update on public.stadium_visits
for each row execute function public.touch_updated_at();
