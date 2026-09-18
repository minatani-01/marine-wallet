-- ============================================================================
-- Marine Wallet / 0042_api_usage
-- ----------------------------------------------------------------------------
-- 外部APIの使用回数を数えて、上限で止める。
--
-- Google マップは無料の範囲（各API 月10,000回）を超えると課金される。
-- Google Cloud 側の割り当て上限が最後の砦だが、アプリ側でも数えて止める。
-- 鍵の制限を外したときや、割り当ての設定を忘れたときに、請求で気付くのでは
-- 遅い。ここで止めれば、そもそも呼ばない。
--
-- 上限は日と月の両方で見る。日だけだと、月末に近づいて月の残りが尽きても
-- 毎日上限まで呼んでしまう。
--
-- 1日の境目は日本時間で切る。UTC で切ると、日本の夜9時に「今日の残り」が
-- 増えることになり、数え方が直感と合わない。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

create table if not exists public.api_usage (
  /** 日本時間の日付 */
  day date not null,
  /** 'maps_js'（地図の読み込み）/ 'geocoding'（座標の取得） */
  api text not null,
  calls integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, api)
);

alter table public.api_usage enable row level security;

comment on table public.api_usage is
  '外部APIの使用回数。上限で止めるために数える。書き込みは spend_api_call だけ';

-- 表そのものは誰にも触らせない。増やすのは SECURITY DEFINER の関数だけ。
-- 画面から直に書けると、上限の意味が無くなる。
revoke all on table public.api_usage from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1回ぶん使う
-- ----------------------------------------------------------------------------
-- 上限に達していれば false を返し、数は増やさない。
-- 同時に呼ばれても二重に数えないよう、行を取ってから増やす。
create or replace function public.spend_api_call(p_api text, p_daily integer, p_monthly integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  jst_today date := ((now() at time zone 'Asia/Tokyo'))::date;
  used_today integer;
  used_month integer;
begin
  insert into public.api_usage (day, api, calls)
  values (jst_today, p_api, 0)
  on conflict (day, api) do nothing;

  select a.calls into used_today
  from public.api_usage a
  where a.day = jst_today and a.api = p_api
  for update;

  select coalesce(sum(a.calls), 0) into used_month
  from public.api_usage a
  where a.api = p_api
    and a.day >= date_trunc('month', jst_today)::date;

  if used_today >= p_daily or used_month >= p_monthly then
    return jsonb_build_object(
      'allowed', false,
      'used_today', used_today,
      'used_month', used_month,
      'daily', p_daily,
      'monthly', p_monthly
    );
  end if;

  update public.api_usage a
  set calls = a.calls + 1, updated_at = now()
  where a.day = jst_today and a.api = p_api;

  return jsonb_build_object(
    'allowed', true,
    'used_today', used_today + 1,
    'used_month', used_month + 1,
    'daily', p_daily,
    'monthly', p_monthly
  );
end;
$function$;

revoke all on function public.spend_api_call(text, integer, integer) from public, anon;
grant execute on function public.spend_api_call(text, integer, integer) to authenticated;
