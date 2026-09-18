-- ============================================================================
-- Marine Wallet / 0043_place_genre
-- ----------------------------------------------------------------------------
-- 場所にジャンルを持たせ、近い球場をやめる。
--
-- 「飲食」だけでは粗すぎる。行きたい店が20件も並ぶと、焼肉の気分のときに
-- 焼肉だけを見られない。種別（観光地・飲食）の下にジャンルを1つ持たせる。
--
-- ジャンルは決まった一覧の id ではなく、書かれた言葉そのものを入れる。
-- 「立ち食いそば」のような、こちらが用意していない言葉を後から足せる。
-- 画面の候補は目安で、絞り込みは実際に入っている言葉から作る。
--
-- 近い球場（stadium_id）は外す。遠征の計画に使う想定だったが、
-- 登録のたびに選ぶ手間のほうが大きかった。使わない列を残すと、
-- 登録画面で毎回「選ばない」を通り過ぎることになる。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

alter table public.places
  add column if not exists genre text not null default '';

comment on column public.places.genre is
  'ジャンル（焼肉・寿司・温泉など）。決まった一覧ではなく書かれた言葉を入れる';

alter table public.places
  drop column if exists stadium_id;

drop index if exists places_stadium_idx;

create index if not exists places_genre_idx on public.places (genre);
