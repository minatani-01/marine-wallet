-- ============================================================================
-- Marine Wallet / 0044_place_genres
-- ----------------------------------------------------------------------------
-- 飲食のジャンルを、自分たちで足せる一覧にする。
--
-- 0043 ではジャンルの候補をコードに書いていた。「立ち食いそば」を足すのに
-- デプロイが要るのはおかしい。貯金のカスタム登録の定型と同じ考え方で、
-- 表に持たせて画面から足せるようにする。
--
-- 観光地にジャンルは付けない。「名所」「公園」と分けても、行きたい場所が
-- 20件も並ぶことがなく、分ける意味が薄い。ジャンルは飲食だけのものとする。
--
-- 名前を直したら、その言葉を使っている場所も追いかけて直す。追いかけないと
-- 「焼肉」を「焼き肉」に直した瞬間、既存の店が絞り込みから外れる。
-- 消したときは場所に書かれた言葉をそのまま残す。候補から外れるだけで、
-- 記録が消える理由は無い。
--
-- 一覧は全員で共有する。場所のリストと同じで、人によって変わらない。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

create table if not exists public.place_genres (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  /** 並び順。小さいほど先に出す */
  sort_order integer not null default 100,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.place_genres enable row level security;

comment on table public.place_genres is
  '飲食のジャンルの候補。画面から足せる。観光地には付けない';

create unique index if not exists place_genres_name_idx on public.place_genres (name);

-- ----------------------------------------------------------------------------
-- 見え方。貯金を共にしている人なら誰でも読み書きできる
-- ----------------------------------------------------------------------------
drop policy if exists place_genres_select on public.place_genres;
create policy place_genres_select on public.place_genres
  for select to authenticated using (public.in_saving_circle());

drop policy if exists place_genres_insert on public.place_genres;
create policy place_genres_insert on public.place_genres
  for insert to authenticated with check (public.in_saving_circle());

drop policy if exists place_genres_update on public.place_genres;
create policy place_genres_update on public.place_genres
  for update to authenticated
  using (public.in_saving_circle()) with check (public.in_saving_circle());

drop policy if exists place_genres_delete on public.place_genres;
create policy place_genres_delete on public.place_genres
  for delete to authenticated using (public.in_saving_circle());

drop trigger if exists place_genres_touch_updated_at on public.place_genres;
create trigger place_genres_touch_updated_at
before update on public.place_genres
for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 名前を直したら、その言葉を使っている場所も直す
-- ----------------------------------------------------------------------------
create or replace function public.place_genres_rename()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.name is distinct from old.name then
    update public.places set genre = new.name where genre = old.name;
  end if;
  return null;
end;
$function$;

drop trigger if exists place_genres_rename on public.place_genres;
create trigger place_genres_rename
after update on public.place_genres
for each row execute function public.place_genres_rename();

-- ----------------------------------------------------------------------------
-- 最初の候補。足りなければ画面から足す
-- ----------------------------------------------------------------------------
insert into public.place_genres (name, sort_order)
values
  ('焼肉', 10), ('寿司', 20), ('ラーメン', 30), ('居酒屋', 40), ('海鮮', 50),
  ('定食', 60), ('カフェ', 70), ('スイーツ', 80), ('B級グルメ', 90)
on conflict (name) do nothing;
