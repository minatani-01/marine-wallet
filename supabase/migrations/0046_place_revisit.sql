-- ============================================================================
-- Marine Wallet / 0046_place_revisit
-- ----------------------------------------------------------------------------
-- 「行った」の代わりに「リピあり・リピなし」を持たせる。
--
-- 行ったかどうかだけでは、次にどこへ行くかを決められない。行った店が
-- 増えるほど「どれがまた行きたい店だったか」を思い出せなくなる。
-- 行ったときに、また行きたいかどうかまで一緒に残す。
--
-- 日付（visited_on）はそのまま残す。行きたい側と行った側を分ける軸は
-- これまでどおり日付が入っているかどうかで、リピの有無はその中の区別。
-- 日付を捨てると、行った順に並べられなくなる。
--
-- すでに行った場所は '' のまま（どちらとも言っていない）。あとから
-- どちらかを押せばよく、こちらで決め打ちしない。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

alter table public.places
  add column if not exists revisit text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'places_revisit_check'
  ) then
    alter table public.places
      add constraint places_revisit_check check (revisit in ('', 'yes', 'no'));
  end if;
end $$;

comment on column public.places.revisit is
  'また行きたいか。yes=リピあり / no=リピなし / 空=まだ決めていない';
