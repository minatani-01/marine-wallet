-- ============================================================================
-- Marine Wallet / 0051_place_types_checked
-- ----------------------------------------------------------------------------
-- 種別とジャンルを Google から取り込んだ日時を持つ。
--
-- 飲食店なのか、それ以外なのか。寿司なのかラーメンなのか。どちらも
-- Google がすでに持っている（Places の types / primaryType）。登録する人が
-- 決めることではないので、写してくる。
--
-- 保存リストの取り込みでは「全部まとめて飲食」としか入れられない。
-- 入れたあとに1件ずつ直すのは続かないので、あとからまとめて取り込めるようにする。
--
-- 取り込んだ日時を残すのは、同じ場所を何度も問い合わせないため。
-- 観光地にはジャンルが付かないので、ジャンルの有無だけでは「まだ見ていない」
-- と「見たが付かなかった」を区別できない。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

alter table public.places
  add column if not exists types_checked_at timestamptz;

comment on column public.places.types_checked_at is
  '種別・ジャンルを Google から取り込んだ日時（0051）。null はまだ取り込んでいない';

-- まだ取り込んでいないものを拾うときに使う
create index if not exists places_types_unchecked_idx
  on public.places (created_at)
  where types_checked_at is null;
