-- ============================================================================
-- Marine Wallet / 0066_subscription_plan_interval
-- ----------------------------------------------------------------------------
-- サブスクに「プラン名」を足し、周期と支払日の持ち方を変える。
--
-- 1. プラン名
--
-- 同じサービスでも契約が分かれる（Netflix のスタンダードとプレミアム、
-- iCloud+ の 50GB と 200GB）。サービス名に押し込むと、並べたときに
-- どちらの話か読み取りにくい。別の欄にする。
--
-- 2. 周期
--
-- 毎月・毎年の2つでは、3か月ごとや半年ごとのものが入らない。
-- 「何か月ごと」で持つ（interval_months）。毎月は1、毎年は12。
--
-- 3. 支払日
--
-- 「毎月N日」「毎年M月N日」をやめ、日付そのものを持つ（anchor_on）。
-- カレンダーから1回選べば、あとはそこから周期ぶんずつ進める。
-- 3か月ごとのように「どの月か」まで決まるものは、日だけでは表せない。
--
-- 古い列から移す。cycle が yearly なら12か月ごと、それ以外は毎月。
-- 支払日は billing_month / billing_day から組み立て、今日より前なら
-- そのまま（次回は周期ぶん進めて出す）。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

alter table public.subscriptions
  add column if not exists plan text not null default '',
  add column if not exists interval_months integer not null default 1,
  add column if not exists anchor_on date;

comment on column public.subscriptions.plan is
  'プラン名。スタンダード・200GB など（0066）';
comment on column public.subscriptions.interval_months is
  '何か月ごとに落ちるか。毎月は1、3か月ごとは3、毎年は12（0066）';
comment on column public.subscriptions.anchor_on is
  '支払日。ここを起点に周期ぶんずつ進めて次回を出す（0066）';

-- ----------------------------------------------------------------------------
-- 古い持ち方から移す
-- ----------------------------------------------------------------------------
do $do$
begin
  -- 周期
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'cycle'
  ) then
    execute $sql$
      update public.subscriptions
      set interval_months = case when cycle = 'yearly' then 12 else 1 end
      where interval_months = 1 and cycle = 'yearly'
    $sql$;
  end if;

  -- 支払日。無い日は末日へ寄せる（make_date は 2/31 で落ちる）
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'billing_day'
  ) then
    execute $sql$
      update public.subscriptions s
      set anchor_on = (
        date_trunc('month', make_date(
          extract(year from current_date)::int,
          coalesce(s.billing_month, extract(month from current_date)::int),
          1
        ))
        + least(
            s.billing_day - 1,
            extract(day from (
              date_trunc('month', make_date(
                extract(year from current_date)::int,
                coalesce(s.billing_month, extract(month from current_date)::int),
                1
              )) + interval '1 month - 1 day'
            ))::int - 1
          ) * interval '1 day'
      )::date
      where s.anchor_on is null
    $sql$;
  end if;
end
$do$;

-- 残っていれば既定の日付を入れてから、必須にする
update public.subscriptions set anchor_on = current_date where anchor_on is null;

alter table public.subscriptions alter column anchor_on set not null;

-- 周期の範囲。5年を超える間隔は、サブスクとしては考えにくい
alter table public.subscriptions drop constraint if exists subscriptions_interval_months_check;
alter table public.subscriptions
  add constraint subscriptions_interval_months_check
  check (interval_months between 1 and 60);

-- ----------------------------------------------------------------------------
-- 使わなくなった列
-- ----------------------------------------------------------------------------
-- cycle / billing_day / billing_month は読まなくなった。既定値を持つので
-- 残っていても書き込みの邪魔にはならないが、次に見る人が迷うので外す。
alter table public.subscriptions drop column if exists cycle;
alter table public.subscriptions drop column if exists billing_month;
alter table public.subscriptions drop column if exists billing_day;

-- 並びは次の支払日で決めるので、日ではなく支払日で引けるようにする
drop index if exists subscriptions_user_idx;
create index if not exists subscriptions_user_idx
  on public.subscriptions (user_id, active, anchor_on);
