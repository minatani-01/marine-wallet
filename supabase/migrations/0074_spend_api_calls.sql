-- ============================================================================
-- Marine Wallet / 0074_spend_api_calls
-- ----------------------------------------------------------------------------
-- 外部APIを「まとめて n 回ぶん」使えるようにする。
--
-- 0042 の spend_api_call は1回ずつしか数えられない。賃貸さがし（0075）で
-- 使う Routes API の徒歩時間は、1回の呼び出しで「駅数 × 建物数」ぶんの
-- 課金単位（element）を消費する。1回として数えると、1日の上限を
-- 100倍ゆるく見積もることになり、止める意味が無くなる。
--
-- 足りない数だけ残っているときは断る（部分的に使わせない）。半分だけ
-- 測った一覧は、徒歩◯分が入っている建物と入っていない建物が混ざるだけで、
-- 見るほうが判断できない。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

create or replace function public.spend_api_calls(
  p_api text,
  p_count integer,
  p_daily integer,
  p_monthly integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  jst_today date := ((now() at time zone 'Asia/Tokyo'))::date;
  want integer := greatest(1, coalesce(p_count, 1));
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

  if used_today + want > p_daily or used_month + want > p_monthly then
    return jsonb_build_object(
      'allowed', false,
      'used_today', used_today,
      'used_month', used_month,
      'daily', p_daily,
      'monthly', p_monthly
    );
  end if;

  update public.api_usage a
  set calls = a.calls + want, updated_at = now()
  where a.day = jst_today and a.api = p_api;

  return jsonb_build_object(
    'allowed', true,
    'used_today', used_today + want,
    'used_month', used_month + want,
    'daily', p_daily,
    'monthly', p_monthly
  );
end;
$function$;

revoke all on function public.spend_api_calls(text, integer, integer, integer) from public, anon;
grant execute on function public.spend_api_calls(text, integer, integer, integer) to authenticated;
