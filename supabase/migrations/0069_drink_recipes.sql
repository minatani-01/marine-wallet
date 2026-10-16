-- ============================================================================
-- Marine Wallet / 0069_drink_recipes
-- ----------------------------------------------------------------------------
-- 特製ドリンクのレシピ（からだの画面）。
--
-- 断食の前後や運動のあとに作るものが決まってくる。そのたびに思い出すのでは
-- 分量が毎回ぶれるし、良かった配合を忘れる。書いて残しておく。
--
-- オートファジーの下に置く。食べない時間と地続きの話なので、同じ画面の
-- 近いところにあったほうが、作るときに探さずに済む。
--
-- 材料は1行1つの文字列で持つ。「プロテイン 30g」のように量まで含めて
-- 書けるようにしたいので、名前と量に分けない。分けると、粉・液体・個数で
-- 単位が割れて、どれにも当てはまらない書き方が出てくる。
--
-- 自分の行だけを扱う。オートファジー（0053）やからだ（0064）と同じ。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

create table if not exists public.drink_recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  /** レシピの名前 */
  name text not null,
  /** いつ飲むか。断食明け・運動後 など。空でもよい */
  timing text not null default '',
  /** 材料。1行1つ */
  ingredients text not null default '',
  /** 作り方やメモ */
  note text not null default '',
  /** 並び順。小さいほど上 */
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.drink_recipes is
  '特製ドリンクのレシピ（0069）';
comment on column public.drink_recipes.ingredients is
  '材料。1行1つ。量まで含めて書く（例: プロテイン 30g）';
comment on column public.drink_recipes.timing is
  'いつ飲むか。断食明け・運動後 など';

create index if not exists drink_recipes_user_idx
  on public.drink_recipes (user_id, sort_order, created_at);

alter table public.drink_recipes enable row level security;

-- ----------------------------------------------------------------------------
-- 見え方。自分の行だけを扱える
-- ----------------------------------------------------------------------------
drop policy if exists drink_recipes_select_own on public.drink_recipes;
create policy drink_recipes_select_own on public.drink_recipes
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists drink_recipes_insert_own on public.drink_recipes;
create policy drink_recipes_insert_own on public.drink_recipes
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists drink_recipes_update_own on public.drink_recipes;
create policy drink_recipes_update_own on public.drink_recipes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists drink_recipes_delete_own on public.drink_recipes;
create policy drink_recipes_delete_own on public.drink_recipes
  for delete to authenticated using (user_id = (select auth.uid()));

drop trigger if exists drink_recipes_touch_updated_at on public.drink_recipes;
create trigger drink_recipes_touch_updated_at
  before update on public.drink_recipes
  for each row execute function public.touch_updated_at();
