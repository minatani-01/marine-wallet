-- ============================================================================
-- Marine Wallet / 0047_npb_standings
-- ----------------------------------------------------------------------------
-- パ・リーグの順位を出せるようにする。
--
-- これまで貯めていた npb_games はマリーンズの試合だけで、他球団同士の
-- 試合が無い。勝率は自分の試合だけで出せるが、順位は6球団ぶんの勝敗が
-- 要る。日程ページ（schedule_MM_detail.html）には12球団すべての試合が
-- 載っていて、すでに毎朝取っている。捨てていた他球団の行を残すだけで
-- 順位を出せる。新しく取りに行くページは増えない。
--
-- npb_games には入れない。あちらは「前日の1試合」を見て貯金に入れる
-- 入口になっていて、1日に複数行あると人の確認待ちになる（register.ts）。
-- 全球団の試合を混ぜると毎日それに当たるので、表を分ける。
--
-- 順位は毎朝の取り込みで計算して npb_standings に書く。ホームでは
-- 6行読むだけにしたい。試合を毎回集計すると、シーズン終盤には
-- 800行を超える。
--
-- ダブルヘッダーは開始時刻で区別する（同じ日・同じ組み合わせが2試合）。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

create table if not exists public.npb_league_games (
  game_date date not null,
  /** npb.jp の日程表の表記。ロッテ / 日本ハム / DeNA など */
  home_team text not null,
  away_team text not null,
  home_score integer,
  away_score integer,
  /** ダブルヘッダーを分けるために鍵に入れる */
  start_time text not null default '',
  status text not null default 'scheduled',
  /** 備考。クライマックスシリーズなどを見分けるために残す */
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (game_date, home_team, away_team, start_time)
);

alter table public.npb_league_games enable row level security;

comment on table public.npb_league_games is
  '12球団すべての試合（日程ページ由来）。順位の計算だけに使う。貯金には使わない';

create index if not exists npb_league_games_date_idx
  on public.npb_league_games (game_date);

drop policy if exists npb_league_games_select on public.npb_league_games;
create policy npb_league_games_select on public.npb_league_games
  for select to authenticated using (true);

create table if not exists public.npb_standings (
  season integer not null,
  team text not null,
  /** 'p' パ・リーグ / 'c' セ・リーグ */
  league text not null,
  win integer not null default 0,
  lose integer not null default 0,
  draw integer not null default 0,
  /** 勝率。勝敗が1つも無ければ null（0.000 と区別する） */
  rate numeric(4, 3),
  rank integer not null default 0,
  /** 首位とのゲーム差。首位は 0 */
  games_behind numeric(4, 1) not null default 0,
  /** 集計に入れた最後の試合日 */
  as_of date,
  updated_at timestamptz not null default now(),
  primary key (season, team)
);

alter table public.npb_standings enable row level security;

comment on table public.npb_standings is
  'リーグ順位。npb_league_games から毎朝計算して入れ替える';

drop policy if exists npb_standings_select on public.npb_standings;
create policy npb_standings_select on public.npb_standings
  for select to authenticated using (true);
