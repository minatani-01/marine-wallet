-- ============================================================================
-- Marine Wallet / 0059_share_custom_scene
-- ----------------------------------------------------------------------------
-- カスタム登録を全員に広げるトリガーに、0057 で足した3列を写させる。
--
--   scene           名場面
--   uniform_number  背番号
--   player_name     選手名
--
-- 0057 で列を足したとき、このトリガーを直し忘れていた。そのため書いた本人の
-- 行にだけ名場面と選手が入り、一緒に貯めている相手の行では抜けていた。
-- 相手の画面では「プロ初H」とだけ出て、誰の記録か分からない。
--
-- 列を足したら、その列を写すところも同じ回で直さないと、こうなる。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. トリガーを直す
-- ----------------------------------------------------------------------------
create or replace function public.saving_entries_share_custom()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  u uuid;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if new.kind <> 'custom' or new.custom_group_id is null then
      return null;
    end if;

    insert into public.saving_entries (
      user_id, game_id, kind, scene, title, uniform_number, player_name,
      entry_date, amount, breakdown, other_amount, other_note, custom_group_id
    )
    select t, null, 'custom', new.scene, new.title, new.uniform_number, new.player_name,
           new.entry_date, new.amount, new.breakdown,
           new.other_amount, new.other_note, new.custom_group_id
    from public.saving_target_users() t
    where t <> new.user_id
      and not exists (
        select 1 from public.saving_entries e
        where e.user_id = t and e.custom_group_id = new.custom_group_id
      );

    for u in select public.saving_target_users() loop
      perform public.resync_confirmed_amount(u, new.month);
    end loop;
    return null;
  end if;

  if tg_op = 'UPDATE' then
    if new.kind <> 'custom' or new.custom_group_id is null then
      return null;
    end if;

    update public.saving_entries e
    set entry_date = new.entry_date,
        scene = new.scene,
        title = new.title,
        uniform_number = new.uniform_number,
        player_name = new.player_name,
        amount = new.amount,
        breakdown = new.breakdown,
        other_amount = new.other_amount,
        other_note = new.other_note
    where e.custom_group_id = new.custom_group_id
      and e.id <> new.id;

    for u in select public.saving_target_users() loop
      perform public.resync_confirmed_amount(u, old.month);
      perform public.resync_confirmed_amount(u, new.month);
    end loop;
    return null;
  end if;

  if old.kind <> 'custom' or old.custom_group_id is null then
    return null;
  end if;

  delete from public.saving_entries e where e.custom_group_id = old.custom_group_id;

  for u in select public.saving_target_users() loop
    perform public.resync_confirmed_amount(u, old.month);
  end loop;
  return null;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 2. 抜けたまま残っている行を揃える
-- ----------------------------------------------------------------------------
-- 同じ custom_group_id の中で、名場面の入っている行を正とする。
-- 書いた本人の行だけが埋まっているので、それを相手の行へ写す。
update public.saving_entries e
set scene = src.scene,
    uniform_number = src.uniform_number,
    player_name = src.player_name
from (
  select distinct on (custom_group_id)
    custom_group_id, scene, uniform_number, player_name
  from public.saving_entries
  where kind = 'custom'
    and custom_group_id is not null
    and btrim(scene) <> ''
  order by custom_group_id, updated_at desc
) src
where e.kind = 'custom'
  and e.custom_group_id = src.custom_group_id
  and btrim(e.scene) = ''
  and (e.scene is distinct from src.scene
    or e.uniform_number is distinct from src.uniform_number
    or e.player_name is distinct from src.player_name);
