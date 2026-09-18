-- ============================================================================
-- Marine Wallet / 0045_place_business_status
-- ----------------------------------------------------------------------------
-- 閉店していないかを月に1回見て、結果を残す。
--
-- 行きたい店のリストは寝かせると腐る。何年も前に入れた店が無くなっていても、
-- リストの上では生きたままになる。遠征の前に一軒ずつ調べるのは現実的でない。
--
-- Google 側の営業状態（OPERATIONAL / CLOSED_TEMPORARILY / CLOSED_PERMANENTLY）
-- をそのまま持つ。こちらで「閉店」と言い切らず、向こうの言葉を残しておけば、
-- 一時休業と閉店を取り違えない。
--
-- 消しはしない。閉店していても「行った場所」の記録は残す価値があるし、
-- 判定が間違っていることもある。印を付けるだけにして、消すかどうかは
-- 人が決める。
--
-- 状態はジャンルとは別に持つ。ジャンルは自分たちで足す・直す・消すもので、
-- 「焼肉」は閉店しても焼肉のままである。ジャンルの一覧から「閉店」を
-- 消した拍子に、閉店の印まで消えるような作りにはしない。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

alter table public.places
  add column if not exists business_status text not null default '',
  add column if not exists status_checked_at timestamptz;

comment on column public.places.business_status is
  'Google 側の営業状態。OPERATIONAL / CLOSED_TEMPORARILY / CLOSED_PERMANENTLY。空は未確認';
comment on column public.places.status_checked_at is
  '最後に営業状態を見た時刻。古い順に見に行くため';

create index if not exists places_status_checked_idx
  on public.places (status_checked_at nulls first);
