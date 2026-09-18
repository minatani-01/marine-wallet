-- ============================================================================
-- Marine Wallet / 0039_stadium_visit_companions
-- ----------------------------------------------------------------------------
-- 一緒に行ったか、一人で行ったかを残す。
--
-- 現地観戦は人ごとの記録（0038）だが、実際にはたいてい誰かと行く。
-- 「この日は二人で行った」「この日は一人だった」が残っていないと、
-- あとでスタンプを見返したときに一番思い出したいことが抜ける。
--
-- 同行者は名前で持たず、アカウントの id で持つ。文字で持つと表記ゆれで
-- 同じ人が別人になり、名前を変えたときに過去の記録が追従しない。
--
-- 一緒に行ったのなら、相手も行っている。片方が押したら相手の帳面にも
-- スタンプが付くようにする。押す操作を二人ぶんやらせる意味が無い。
-- RLS は自分の行しか許さないので、伝えるのは SECURITY DEFINER の
-- トリガーが行う（カスタム登録の共有 0036 と同じ形）。
--
-- ただし相手の記録を消すのは、自分が作った写しだけにする。
-- 相手が自分で押した記録は、こちらの取り消しでは消さない。
-- 「一緒だったことにするのをやめた」と「相手は行っていない」は違う。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

alter table public.stadium_visits
  add column if not exists companions uuid[] not null default '{}',
  add column if not exists created_by uuid references auth.users(id) on delete set null;

comment on column public.stadium_visits.companions is
  '一緒に行った人。空なら一人で行った';
comment on column public.stadium_visits.created_by is
  'この行を作った人。写しを片付けるときに、相手が自分で押した記録と区別する';

-- 0038 までの記録は、押した本人が作ったもの
update public.stadium_visits set created_by = user_id where created_by is null;

-- ----------------------------------------------------------------------------
-- 一緒に行った人へ伝える
-- ----------------------------------------------------------------------------
-- pg_trigger_depth() で、写しを作ったことがさらに写しを呼ばないようにする。
create or replace function public.stadium_visits_share_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid;
  grp uuid[];
  dropped uuid[];
  m uuid;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  if tg_op = 'DELETE' then
    -- 自分が連れて行った人の写しだけを片付ける
    delete from public.stadium_visits v
    where v.user_id = any(old.companions)
      and v.created_by = old.user_id
      and v.user_id <> old.user_id
      and v.stadium_id = old.stadium_id
      and v.visited_on = old.visited_on
      and v.game_id is not distinct from old.game_id;

    -- 相手が自分で押していた記録からは、自分の名前だけ外す
    update public.stadium_visits v
    set companions = array_remove(v.companions, old.user_id)
    where v.user_id = any(old.companions)
      and v.stadium_id = old.stadium_id
      and v.visited_on = old.visited_on
      and v.game_id is not distinct from old.game_id;
    return null;
  end if;

  actor := new.user_id;

  -- その日その球場にいた人たち。貯金を共にしていない相手は入れない
  grp := array(
    select distinct u
    from unnest(array_append(new.companions, actor)) u
    where u in (select public.saving_target_users())
  );

  foreach m in array grp loop
    if m = actor then
      continue;
    end if;

    insert into public.stadium_visits (
      user_id, stadium_id, visited_on, game_id, note, companions, created_by
    )
    values (
      m, new.stadium_id, new.visited_on, new.game_id, new.note,
      array(select u from unnest(grp) u where u <> m), actor
    )
    on conflict do nothing;

    -- すでに相手が押していたなら、同行者だけ足す
    update public.stadium_visits v
    set companions = array(
          select distinct u
          from unnest(v.companions || array(select u from unnest(grp) u where u <> m)) u
        )
    where v.user_id = m
      and v.stadium_id = new.stadium_id
      and v.visited_on = new.visited_on
      and v.game_id is not distinct from new.game_id;
  end loop;

  if tg_op = 'UPDATE' then
    dropped := array(select u from unnest(old.companions) u where not (u = any(grp)));

    if coalesce(array_length(dropped, 1), 0) > 0 then
      delete from public.stadium_visits v
      where v.user_id = any(dropped)
        and v.created_by = actor
        and v.user_id <> actor
        and v.stadium_id = new.stadium_id
        and v.visited_on = new.visited_on
        and v.game_id is not distinct from new.game_id;

      update public.stadium_visits v
      set companions = array_remove(v.companions, actor)
      where v.user_id = any(dropped)
        and v.stadium_id = new.stadium_id
        and v.visited_on = new.visited_on
        and v.game_id is not distinct from new.game_id;
    end if;
  end if;

  return null;
end;
$function$;

drop trigger if exists stadium_visits_share_group on public.stadium_visits;
create trigger stadium_visits_share_group
after insert or update or delete on public.stadium_visits
for each row execute function public.stadium_visits_share_group();

-- ----------------------------------------------------------------------------
-- 同行者を選ぶための名前
-- ----------------------------------------------------------------------------
-- 貯金を共にしている人の id と名前だけを返す。金額も連絡先も返さない。
create or replace function public.saving_circle_members()
returns table (id uuid, member_name text, is_self boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
         coalesce(nullif(p.display_name, ''), 'メンバー') as member_name,
         p.id = (select auth.uid()) as is_self
  from public.profiles p
  where p.id in (select public.saving_target_users())
  order by (p.id = (select auth.uid())) desc, p.display_name;
$$;

revoke all on function public.saving_circle_members() from public, anon;
grant execute on function public.saving_circle_members() to authenticated;
