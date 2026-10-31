-- ============================================================================
-- Marine Wallet / 0098_refund_api_calls
-- ----------------------------------------------------------------------------
-- 使わなかったぶんの外部API予算を戻す。
--
-- 予算（0042 / 0074）は呼ぶ前に引く。引けなければ呼ばない。だが Google が
-- 429（割り当て切れ）や 403（鍵の制限）で断った呼び出しは課金されない。
-- 戻さないと、Google 側の設定ミスで何も取れなかった日に、こちらの予算まで
-- 空になる。実際に 2026-10-31 はそれで止まった。
--
-- 今日の行から引くだけ。0 より下にはしない。行が無ければ何もしない。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

create or replace function public.refund_api_calls(p_api text, p_count integer)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  jst_today date := ((now() at time zone 'Asia/Tokyo'))::date;
  back integer := greatest(0, coalesce(p_count, 0));
begin
  if back = 0 then
    return;
  end if;

  update public.api_usage a
  set calls = greatest(0, a.calls - back), updated_at = now()
  where a.day = jst_today and a.api = p_api;
end;
$function$;

revoke all on function public.refund_api_calls(text, integer) from public, anon;
grant execute on function public.refund_api_calls(text, integer) to authenticated;
