-- ============================================================================
-- Marine Wallet / 0029_npb_milestone_pages
-- ----------------------------------------------------------------------------
-- 「今季達成が予想される記録」のページを、取ったまま置いておく。
--
--   打撃 https://npb.jp/history/2026/milestones_b.html
--   投手 https://npb.jp/history/2026/milestones_p.html
--   チーム https://npb.jp/history/2026/milestones_team.html
--
-- これらのページは「あと何本で通算◯◯」という形で、達成が近い選手が並ぶ。
-- 毎日取って前日と比べれば、マリーンズの選手が記録に届いた日が分かる。
--
-- ただし、まず中身を見ないと読み取り方を決められない。試合のときと同じで、
-- 判断を入れずに貯めるだけの段を先に作る。ここで金額は一切動かない。
--
-- 最新の1回分だけを持つ（kind が主キー）。履歴が要るのは解析後に入れる
-- 構造化した行のほうで、生のHTMLは「読み取りに失敗したとき何が来ていたか」を
-- 確かめるためのもの。
--
-- 書けるのは service role だけ。ポリシーを置かないので、
-- ログイン中の利用者からは読み書きできない。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

create table if not exists public.npb_milestone_pages (
  -- 'batting' / 'pitching' / 'team'
  kind text primary key,

  url text not null,
  html text not null,
  /** 取得できた年。年が変わればURLも変わる */
  season integer not null,

  fetched_at timestamptz not null default now()
);

alter table public.npb_milestone_pages enable row level security;

comment on table public.npb_milestone_pages is
  'npb.jp の「達成が予想される記録」ページの取得結果。解析前の生データ';
