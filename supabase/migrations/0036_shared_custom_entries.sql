-- ============================================================================
-- Marine Wallet / 0036_shared_custom_entries
-- ----------------------------------------------------------------------------
-- カスタム登録を全員で共有する。
--
-- これまでカスタム登録は各自の行で、編集も削除も自分の行にしか届かなかった。
-- 中身は「6/12の山本の初サヨナラ打」のようにチームの出来事そのもので、
-- 人によって違うものではない。実際、マスターが書き方を直したあと他の2人だけ
-- 古い文面のまま残り、金額まで食い違った。
--
-- 試合（games → saving_entries）と同じ形にする。ただし試合と違って金額は
-- 全員同じ（フェーズ倍率も個人ルールも効かない）ので、別のテーブルは作らず、
-- 同じ出来事の行に共通の印（custom_group_id）を持たせて束ねる。
--
-- 誰でも登録・編集・削除できる。自分の行に加えた変更が、束ねた他の人の行へ
-- そのまま伝わる。RLS は自分の行しか許さないので、伝えるのは
-- SECURITY DEFINER のトリガーが行う。
--
-- 確定済み・入金済みの月は、変更のたびに確定額を集計値へ合わせ直す。
-- 累計は確定額を足して出すので、ここを合わせないと累計に乗らない。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 同じ出来事を束ねる印
-- ----------------------------------------------------------------------------

alter table public.saving_entries
  add column if not exists custom_group_id uuid;

comment on column public.saving_entries.custom_group_id is
  'カスタム登録を全員ぶん束ねる印。同じ出来事の行は同じ値を持つ';

create index if not exists saving_entries_custom_group_idx
  on public.saving_entries (custom_group_id);

-- すでにある行を、日付・定型・金額・内容が同じものどうしで束ねる。
-- 0036 の前に揃えてあるので、これで全員ぶんが1つにまとまる
with grouped as (
  select entry_date, title, amount, other_note, gen_random_uuid() as gid
  from public.saving_entries
  where kind = 'custom' and custom_group_id is null
  group by entry_date, title, amount, other_note
)
update public.saving_entries e
set custom_group_id = g.gid
from grouped g
where e.kind = 'custom'
  and e.custom_group_id is null
  and e.entry_date = g.entry_date
  and e.title = g.title
  and e.amount = g.amount
  and e.other_note = g.other_note;

-- ----------------------------------------------------------------------------
-- 2. 確定額を集計値へ合わせ直す
-- ----------------------------------------------------------------------------
-- 確定前の月は確定のときに集計しなおすので触らない。
create or replace function public.resync_confirmed_amount(p_user uuid, p_month text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.monthly_savings ms
  set confirmed_amount = (
        select coalesce(sum(e.amount), 0)
        from public.saving_entries e
        where e.user_id = p_user and e.month = p_month
      )
  where ms.user_id = p_user
    and ms.month = p_month
    and ms.status <> 'calculating';
end;
$function$;

revoke all on function public.resync_confirmed_amount(uuid, text) from public, anon;

-- ----------------------------------------------------------------------------
-- 3. 印を付ける
-- ----------------------------------------------------------------------------

create or replace function public.saving_entries_set_custom_group()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.kind = 'custom' and new.custom_group_id is null then
    new.custom_group_id := gen_random_uuid();
  end if;
  return new;
end;
$function$;

drop trigger if exists saving_entries_set_custom_group on public.saving_entries;
create trigger saving_entries_set_custom_group
before insert on public.saving_entries
for each row execute function public.saving_entries_set_custom_group();

-- ----------------------------------------------------------------------------
-- 4. 変更を全員へ伝える
-- ----------------------------------------------------------------------------
-- pg_trigger_depth() で、写しを作ったことがさらに写しを呼ばないようにする。
-- 記録達成（sync_saving_entry_for_milestone）も深さ2で入るので素通りする。
-- あちらは最初から全員ぶんをまとめて作っており、二重に作らせない。
create or replace function public.saving_entries_share_custom()
returns trigger
language plpgsql
security definer
set search_path = ''
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
      user_id, game_id, kind, title, entry_date, amount, breakdown,
      other_amount, other_note, custom_group_id
    )
    select t, null, 'custom', new.title, new.entry_date, new.amount, new.breakdown,
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
        title = new.title,
        amount = new.amount,
        breakdown = new.breakdown,
        other_amount = new.other_amount,
        other_note = new.other_note
    where e.custom_group_id = new.custom_group_id
      and e.id <> new.id;

    -- 日付を動かすと月が変わる。動かす前の月も合わせ直す
    for u in select public.saving_target_users() loop
      perform public.resync_confirmed_amount(u, old.month);
      perform public.resync_confirmed_amount(u, new.month);
    end loop;
    return null;
  end if;

  -- DELETE
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

drop trigger if exists saving_entries_share_custom on public.saving_entries;
create trigger saving_entries_share_custom
after insert or update or delete on public.saving_entries
for each row execute function public.saving_entries_share_custom();

-- ----------------------------------------------------------------------------
-- 5. 記録達成も同じ印で束ねる
-- ----------------------------------------------------------------------------
-- 自動で入った積立も、あとから文面を直したくなることがある。
-- 印が無いと直しが自分の行で止まるので、作るときに束ねておく。
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
  gid uuid;
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

  -- すでに誰かに入っていれば、その束に合わせる。無ければ新しく束ねる
  select e.custom_group_id into gid
  from public.saving_entries e
  where e.kind = 'custom' and e.other_note like m.title || '%'
  limit 1;

  if gid is null then
    gid := gen_random_uuid();
  end if;

  for u in select public.saving_target_users() loop
    insert into public.saving_entries (
      user_id, game_id, kind, title, entry_date, amount, breakdown,
      other_amount, other_note, custom_group_id
    )
    select u, null, 'custom', m.tier, m.achieved_on, amt,
           jsonb_build_array(
             jsonb_build_object('key', 'custom', 'label', m.tier, 'amount', amt)
           ),
           0, m.title, gid
    where not exists (
      select 1
      from public.saving_entries e
      where e.user_id = u
        and e.kind = 'custom'
        and e.other_note like m.title || '%'
    );

    if found then
      made := made + 1;
      perform public.resync_confirmed_amount(u, to_char(m.achieved_on, 'YYYY-MM'));
    end if;
  end loop;

  return made;
end;
$function$;

revoke all on function public.sync_saving_entry_for_milestone(uuid) from public, anon;
