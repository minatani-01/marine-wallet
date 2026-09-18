-- ============================================================================
-- Marine Wallet / 0041_place_coordinates
-- ----------------------------------------------------------------------------
-- 場所に座標を持たせる。
--
-- 0040 では座標を持たないことにした。地図はリンクで開けば足り、座標は
-- 店の移転で静かに嘘になるからである。地図に自分たちのピンを並べるには
-- 座標が要るので、ここで方針を変える。
--
-- 嘘になる問題は、正本を名前と場所（name / area）のままにして残す。
-- 座標はそこから引いた写しにすぎず、名前を直せば引き直す。いつ引いたかを
-- 残しておき、古い座標は引き直せるようにする。
--
-- 引くのは Google の Geocoding API で、保存は1件につき1回だけ。
-- 地図を開くたびに引くと、無料の範囲（月10,000回）を個人利用でも
-- 使い切りかねない。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

alter table public.places
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists geocoded_at timestamptz,
  /** 座標を引いたときの検索文字列。名前や場所を直したら引き直す目印 */
  add column if not exists geocoded_query text;

comment on column public.places.lat is
  '緯度。名前と場所から引いた写し。正本は name / area';
comment on column public.places.geocoded_query is
  '座標を引いたときの検索文字列。いまの name / area と違えば引き直す';
