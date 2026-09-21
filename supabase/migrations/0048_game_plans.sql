-- ============================================================================
-- Marine Wallet / 0048_game_plans
-- ----------------------------------------------------------------------------
-- これからの試合に「観戦予定」を付ける。
--
-- 行った記録（stadium_visits）は終わった試合のもので、これから行く試合には
-- 使えない。予定と記録を同じ表に混ぜると、「行ったことになっている試合」と
-- 「行くつもりの試合」の区別が付かなくなる。表を分ける。
--
-- 予定は人ごとに持つ。相手のぶんは読めるようにしておく。「その日は相手も
-- 行く」が見えると、待ち合わせの相談になる。読めるのは貯金の共有を
-- 許可している相手だけで、stadium_visits と同じ考え方にする。
--
-- 試合は日付で指す。マリーンズの試合は1日1試合で、これから行われる試合は
-- まだ games に無い（終わってから入る）。npb_games を外部キーで指すことも
-- できるが、あちらは取り込みのたびに入れ替わる作業用の表なので、
-- 予定が巻き込まれないよう日付だけを持つ。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

create table if not exists public.game_plans (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users(id) on delete cascade,

  /** 観戦する予定の試合日 */
  game_date date not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.game_plans enable row level security;

comment on table public.game_plans is
  'これからの試合の観戦予定。終わった試合の記録は stadium_visits';

-- 同じ日に二度付けない
create unique index if not exists game_plans_user_date_idx
  on public.game_plans (user_id, game_date);

-- ----------------------------------------------------------------------------
-- 見え方。自分のぶんは読み書き、接続している相手のぶんは読むだけ
-- ----------------------------------------------------------------------------
drop policy if exists game_plans_select_own on public.game_plans;
create policy game_plans_select_own on public.game_plans
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists game_plans_select_linked on public.game_plans;
create policy game_plans_select_linked on public.game_plans
  for select to authenticated
  using (
    user_id <> (select auth.uid())
    and public.marine_link_allows(user_id, 'saving')
  );

drop policy if exists game_plans_insert_own on public.game_plans;
create policy game_plans_insert_own on public.game_plans
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists game_plans_delete_own on public.game_plans;
create policy game_plans_delete_own on public.game_plans
  for delete to authenticated
  using (user_id = (select auth.uid()));

drop trigger if exists game_plans_touch_updated_at on public.game_plans;
create trigger game_plans_touch_updated_at
before update on public.game_plans
for each row execute function public.touch_updated_at();
