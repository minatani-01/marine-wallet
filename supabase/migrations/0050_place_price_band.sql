-- ============================================================================
-- Marine Wallet / 0050_place_price_band
-- ----------------------------------------------------------------------------
-- 飲食の場所に価格帯を持たせる。低・中・高の3段階。
--
-- 行きたい店が増えるほど「いま出せる金額の店はどれか」で選びたくなる。
-- 遠征の前後は特にそうで、昼は軽く、夜は奮発する、という決め方をする。
-- ジャンルや食材では絞れない軸なので、別に持つ。
--
-- 金額そのものは入れない。店の値段は変わるし、同じ店でも昼と夜で違う。
-- 入れ直す手間のわりに当たらない数字になる。3段階なら、入れるときに
-- 迷わず、あとから見ても意味が変わらない。
--
-- 空は「まだ決めていない」。観光地にも列はあるが、画面では飲食のときだけ
-- 出す。種別を観光地へ変えたときは空に戻す（ジャンル・食材と同じ扱い）。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

alter table public.places
  add column if not exists price_band text not null default '';

comment on column public.places.price_band is '価格帯。low 低 / mid 中 / high 高 / 空 未設定';

-- 決められた言葉だけを入れる。表記ゆれが入ると絞り込みが当たらなくなる
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'places_price_band_check'
  ) then
    alter table public.places
      add constraint places_price_band_check
      check (price_band in ('', 'low', 'mid', 'high'));
  end if;
end $$;

-- 価格帯で絞るときに使う。未設定は絞り込みの対象にならないので省く
create index if not exists places_price_band_idx
  on public.places (price_band)
  where price_band <> '';
