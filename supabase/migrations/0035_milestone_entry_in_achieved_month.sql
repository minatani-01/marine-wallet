-- ============================================================================
-- Marine Wallet / 0035_milestone_entry_in_achieved_month
-- ----------------------------------------------------------------------------
-- 記録達成の積立を、必ず達成した月へ入れる。
--
-- 0033 では、達成月がもう確定・入金済みのときに今月へ寄せていた。
-- 累計は確定額を足すので、確定済みの月に足しても累計に乗らないためだった。
-- ただし記録は「その月の出来事」で、8月の達成が9月の行に並ぶと履歴が読めない。
--
-- 寄せるのをやめて、達成月に入れる。そのうえで、その月がもう確定・入金済み
-- なら確定額も同じだけ上げる。こうすれば月別も累計も食い違わない。
--
--   確定前（calculating） … 集計しなおすので確定額は触らない
--   確定済み / 入金済み   … 確定額に積立の額を足す
--
-- 入金済みの月の確定額が上がると、その差額はまだワンバンクへ入れていない
-- ことになる。金額が宙に浮くよりは、足りていないと分かるほうがよい。
--
-- 冪等性: 何度実行しても安全。積立が既にあれば何もしない。
-- ============================================================================

create or replace function public.sync_saving_entry_for_milestone(p_milestone_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  m public.npb_milestones;
  amt integer;
  u uuid;
  made integer := 0;
begin
  select * into m from public.npb_milestones where id = p_milestone_id;
  if not found then
    return 0;
  end if;

  select amount into amt
  from public.saving_custom_presets
  where label = m.tier;

  -- 定型が無い・0円なら積み立てない。台帳には残るので、あとから拾える
  if amt is null or amt <= 0 then
    return 0;
  end if;

  for u in select public.saving_target_users() loop
    -- 同じ記録を二度入れない。台帳の一意キーで防いでいるが、
    -- 台帳を作り直したときのために積立側でも見ておく
    insert into public.saving_entries (
      user_id, game_id, kind, title, entry_date, amount, breakdown, other_amount, other_note
    )
    select u, null, 'custom', m.tier, m.achieved_on, amt,
           jsonb_build_array(
             jsonb_build_object('key', 'custom', 'label', m.tier, 'amount', amt)
           ),
           0, m.title
    where not exists (
      select 1
      from public.saving_entries e
      where e.user_id = u
        and e.kind = 'custom'
        and e.other_note like m.title || '%'
    );

    if found then
      made := made + 1;

      -- 確定済みの月に足したぶんは、確定額にも足す。
      -- 累計は確定額を足して出すので、ここを合わせないと累計に乗らない
      update public.monthly_savings ms
      set confirmed_amount = coalesce(ms.confirmed_amount, 0) + amt
      where ms.user_id = u
        and ms.month = to_char(m.achieved_on, 'YYYY-MM')
        and ms.status <> 'calculating';
    end if;
  end loop;

  return made;
end;
$function$;

revoke all on function public.sync_saving_entry_for_milestone(uuid) from public, anon;
