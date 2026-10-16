-- ============================================================================
-- Marine Wallet / 0068_autophagy_sleep
-- ----------------------------------------------------------------------------
-- オートファジーのカードに睡眠時間を足す。
--
-- 食べない時間の大半は寝ている時間である。並べて出せば「16時間のうち7時間は
-- 寝ているだけ」と分かり、残りどれくらい我慢するのかが読める。並べないと、
-- 16時間がまるごと空腹に見える。
--
-- 持ち方は食べない時間と揃える。始まりの時刻と長さの2つだけ。終わりは
-- 足せば出るので入れてもらわない（0053 と同じ理由）。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

alter table public.autophagy_settings
  add column if not exists sleep_start time not null default '23:00',
  add column if not exists sleep_hours integer not null default 7;

comment on column public.autophagy_settings.sleep_start is
  '寝る時刻（日本時間）（0068）';
comment on column public.autophagy_settings.sleep_hours is
  '寝ている長さ（時間）。起きる時刻はこれを足して出す（0068）';

-- 0時間や24時間を入れると「ずっと寝ている」になり、帯の境目が無くなる
alter table public.autophagy_settings drop constraint if exists autophagy_sleep_hours_check;
alter table public.autophagy_settings
  add constraint autophagy_sleep_hours_check
  check (sleep_hours between 1 and 23);
