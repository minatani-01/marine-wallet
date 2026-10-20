-- ============================================================================
-- Marine Wallet / 0073_subscription_interval_unit
-- ----------------------------------------------------------------------------
-- 周期に「週」を足す。
--
-- 0066 では「何か月ごと」（interval_months）で持たせた。だが週ぎめのものは
-- 月に収まらない。1週間は月の長さで変わらないので、月数に直すと必ずずれる。
--
-- 「数」と「単位」で持つ。
--   interval_count   数（1以上）
--   interval_unit    week / month / year
--
-- 月数に正規化しないのは、2週間ごとを 0.46 か月として持っても、次の支払日を
-- 出すときに結局は日で数え直すことになるため。単位ごとに数え方が違う
-- （週は日で足す、月と年は月で足して無い日を末日に寄せる）ので、入れたまま
-- 持っておくほうが計算も読みも素直になる。
--
-- 古い列から移す。12の倍数なら年、それ以外は月。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

alter table public.subscriptions
  add column if not exists interval_unit text not null default 'month',
  add column if not exists interval_count integer not null default 1;

comment on column public.subscriptions.interval_unit is
  '周期の単位。week / month / year（0073）';
comment on column public.subscriptions.interval_count is
  '周期の数。2 と week なら2週間ごと（0073）';

-- ----------------------------------------------------------------------------
-- 古い持ち方から移す
-- ----------------------------------------------------------------------------
do $do$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'subscriptions'
      and column_name = 'interval_months'
  ) then
    execute $sql$
      update public.subscriptions
      set interval_unit = case when interval_months % 12 = 0 then 'year' else 'month' end,
          interval_count = case when interval_months % 12 = 0 then interval_months / 12
                                else interval_months end
      where interval_count = 1 and interval_unit = 'month' and interval_months <> 1
    $sql$;
  end if;
end
$do$;

alter table public.subscriptions drop constraint if exists subscriptions_interval_unit_check;
alter table public.subscriptions
  add constraint subscriptions_interval_unit_check
  check (interval_unit in ('week', 'month', 'year'));

-- 上限は単位ごとに画面側で決める（週52・月60・年5）。ここは下限だけ見る
alter table public.subscriptions drop constraint if exists subscriptions_interval_count_check;
alter table public.subscriptions
  add constraint subscriptions_interval_count_check
  check (interval_count >= 1);

-- 使わなくなった列
alter table public.subscriptions drop column if exists interval_months;
