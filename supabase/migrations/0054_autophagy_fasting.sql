-- ============================================================================
-- Marine Wallet / 0054_autophagy_fasting
-- ----------------------------------------------------------------------------
-- オートファジーを「食べない時間」で持ち直す。
--
-- 0053 では食べてよい時間の始まりと終わりを2つ持っていた。
-- 決めているのは本当は「何時から何時間食べないか」のほうで、食べてよい時間は
-- その残りでしかない。2つ入れさせると、16時間のつもりが15時間になっている、
-- といった食い違いが起きる。始まりと長さだけを持ち、終わりは足して出す。
--
-- 長さは1〜23時間に限る。0だと食べない時間が無くなり、24だとずっと食べられ
-- なくなる。どちらも境目が消えて、通知するものが無くなる。
--
-- 既にある行は読み替える。食べてよい時間の終わり（eat_end）が、食べない時間の
-- 始まりである。長さは24時間から食べてよい時間を引く。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

alter table public.autophagy_settings
  add column if not exists fast_start time,
  add column if not exists fast_hours smallint;

-- 0053 の形で入っているぶんを読み替える
update public.autophagy_settings
set
  fast_start = eat_end,
  fast_hours = greatest(
    1,
    least(
      23,
      round(
        24 - (
          extract(epoch from (eat_end - eat_start) + interval '24 hours') % 86400
        ) / 3600.0
      )::int
    )
  )
where fast_start is null;

-- 入っていない行が残らないようにしてから、既定を付けて必須にする
update public.autophagy_settings
set fast_start = time '02:00', fast_hours = 16
where fast_start is null or fast_hours is null;

alter table public.autophagy_settings
  alter column fast_start set default '02:00',
  alter column fast_start set not null,
  alter column fast_hours set default 16,
  alter column fast_hours set not null;

comment on column public.autophagy_settings.fast_start is
  '食べない時間の始まり（日本時間）';
comment on column public.autophagy_settings.fast_hours is
  '食べない時間の長さ（時間）。終わりはこれを足して出す';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'autophagy_fast_hours_check') then
    alter table public.autophagy_settings
      add constraint autophagy_fast_hours_check
      check (fast_hours between 1 and 23);
  end if;
end $$;

-- 食べてよい時間の2列は、もう要らない
alter table public.autophagy_settings
  drop column if exists eat_start,
  drop column if exists eat_end;
