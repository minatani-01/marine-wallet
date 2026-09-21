-- ============================================================================
-- Marine Wallet / 0049_place_genres_multi
-- ----------------------------------------------------------------------------
-- ジャンルを複数持てるようにし、食材を別の軸として分ける。
--
-- 1つの店に1つのジャンルしか付けられないと、「焼肉もやっている居酒屋」を
-- どちらかに寄せることになる。寄せた側でしか見つからない。配列にする。
--
-- 食材はジャンルとは別の軸である。焼肉に対する牛・豚・鶏、ジビエに対する
-- 鴨・猪のように、ジャンルの中でさらに分かれる。同じ一覧に混ぜると
-- 「ジビエ（鴨）」のような掛け合わせの言葉が増えていき、組み合わせの数だけ
-- 候補が膨らむ。軸を分ければ、ジャンル9個・食材10個で90通りを表せる。
--
-- 候補の表（place_genres）は kind で分ける。表を2つに増やすと、名前を直す
-- 仕掛けも並び替えも2つずつ書くことになる。
--
-- いま入っているジャンルは配列へ移す。移し終えても genre 列は消さない。
-- 消すのは、画面がすべて配列を見ていることを確かめてからにする。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

alter table public.places
  add column if not exists genres text[] not null default '{}',
  add column if not exists ingredients text[] not null default '{}';

comment on column public.places.genres is 'ジャンル（複数可）。place_genres の kind=genre と揃える';
comment on column public.places.ingredients is '食材（複数可）。place_genres の kind=ingredient と揃える';

-- いま入っている1つぶんを配列へ移す。二度実行しても増えない
update public.places
set genres = array[genre]
where genre <> '' and cardinality(genres) = 0;

create index if not exists places_genres_idx on public.places using gin (genres);
create index if not exists places_ingredients_idx on public.places using gin (ingredients);

-- ----------------------------------------------------------------------------
-- 候補の表を、ジャンルと食材で分ける
-- ----------------------------------------------------------------------------
alter table public.place_genres
  add column if not exists kind text not null default 'genre';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'place_genres_kind_check') then
    alter table public.place_genres
      add constraint place_genres_kind_check check (kind in ('genre', 'ingredient'));
  end if;
end $$;

comment on column public.place_genres.kind is 'genre=ジャンル / ingredient=食材';

-- 同じ名前でも、ジャンルと食材なら別のものとして持てる（例: 海鮮）
drop index if exists public.place_genres_name_idx;
create unique index if not exists place_genres_kind_name_idx
  on public.place_genres (kind, name);

-- ----------------------------------------------------------------------------
-- 名前を直したら、その言葉を使っている場所も直す（配列版）
-- ----------------------------------------------------------------------------
create or replace function public.place_genres_rename()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.name is distinct from old.name then
    if new.kind = 'ingredient' then
      update public.places
      set ingredients = array_replace(ingredients, old.name, new.name)
      where old.name = any(ingredients);
    else
      update public.places
      set genres = array_replace(genres, old.name, new.name)
      where old.name = any(genres);
      -- 1つだけ持っていた頃の列も揃えておく（まだ残してある）
      update public.places set genre = new.name where genre = old.name;
    end if;
  end if;
  return null;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 食材の最初の候補。足りなければ画面から足す
-- ----------------------------------------------------------------------------
insert into public.place_genres (name, kind, sort_order)
values
  ('牛', 'ingredient', 10), ('豚', 'ingredient', 20), ('鶏', 'ingredient', 30),
  ('羊', 'ingredient', 40), ('馬', 'ingredient', 50), ('鴨', 'ingredient', 60),
  ('猪', 'ingredient', 70), ('鹿', 'ingredient', 80), ('熊', 'ingredient', 90),
  ('魚介', 'ingredient', 100)
on conflict (kind, name) do nothing;
