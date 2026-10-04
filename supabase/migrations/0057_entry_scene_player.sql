-- ============================================================================
-- Marine Wallet / 0057_entry_scene_player
-- ----------------------------------------------------------------------------
-- カスタム登録を5つの項目にそろえ、自動で入るぶんと同じ形にする。
--
--   1 名場面     saving_entries.scene（金額は saving_custom_presets が持つ）
--   2 記録名     saving_entries.title
--   3 背番号・選手名  uniform_number / player_name
--   4 金額       amount
--   5 備考       other_note
--
-- これまで、手で入れるぶんは定型のラベルを title に、「#51 山口 逆転サヨナラHR」
-- を手でメモ欄に書いていた。自動で入るぶんも同じ形（title=名球会記録、
-- メモ=#52益田 通算250セーブ記念）だったので、箱の名前を付け直すだけで揃う。
--
-- メモ欄に書いてあった1行は、背番号・選手名・記録名に分ける。見出しは
-- そこから組み立て直す（lib/saving-label.ts）。1行のまま持つと、番号と名前の
-- あいだを空けるかどうかが人によってばらつき、並べ替えにも使えない。
--
-- 記録名の候補は新しい表に持つ。名場面の候補は saving_custom_presets が
-- そのまま使える（貯金ルールの画面で足せる）。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 積立の列
-- ----------------------------------------------------------------------------
alter table public.saving_entries
  add column if not exists scene text not null default '',
  add column if not exists uniform_number text not null default '',
  add column if not exists player_name text not null default '';

comment on column public.saving_entries.scene is
  '名場面。好プレー / 名球会記録 など。saving_custom_presets.label と揃える';
comment on column public.saving_entries.uniform_number is
  '背番号。入っていれば選手の記録、空なら球団の記録';
comment on column public.saving_entries.player_name is
  '選手名。背番号が分からない昔の選手は、これだけ入ることもある';

-- ----------------------------------------------------------------------------
-- 2. いま入っているぶんを分ける
-- ----------------------------------------------------------------------------
-- title（定型のラベル）が名場面にあたる。メモの1行から3つを取り出す。
-- 正規表現は lib/saving-label.ts の parseLegacyNote と同じ読み分けにしてある。
update public.saving_entries e
set
  scene = e.title,
  uniform_number = coalesce(substring(btrim(e.other_note) from '^#([0-9]+) ?\S+'), ''),
  player_name = coalesce(substring(btrim(e.other_note) from '^#[0-9]+ ?(\S+)'), ''),
  title = coalesce(
    -- 「#51 山口 逆転サヨナラHR」→「逆転サヨナラHR」
    substring(btrim(e.other_note) from '^#[0-9]+ ?\S+ ?(.*)$'),
    -- 「マリーンズ 5500敗記念」→「5500敗記念」
    substring(btrim(e.other_note) from '^マリーンズ (.*)$'),
    -- どちらでもなければ、1行まるごとを記録名にする
    btrim(e.other_note)
  ),
  other_note = ''
where e.kind = 'custom'
  and e.scene = ''
  and btrim(coalesce(e.other_note, '')) <> '';

-- メモが空だった手入力ぶんは、定型のラベルを名場面に写すだけにする。
-- 記録名が空になるが、見出しは名場面が出るので画面は読める
update public.saving_entries
set scene = title, title = ''
where kind = 'custom' and scene = '' and btrim(coalesce(other_note, '')) = '';

-- ----------------------------------------------------------------------------
-- 3. 記録名の候補
-- ----------------------------------------------------------------------------
-- 名場面の候補は saving_custom_presets がそのまま使える。記録名は新しく持つ。
-- 共有のもの（全員で同じ一覧を見る）。貯金のリストと同じ扱いにする。
create table if not exists public.saving_record_names (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  /** 並び順。小さいほど先に出す */
  sort_order integer not null default 100,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.saving_record_names enable row level security;

comment on table public.saving_record_names is
  '記録名の候補。登録のときに一覧に無い言葉を書くと、ここへ足される';

create unique index if not exists saving_record_names_name_idx
  on public.saving_record_names (name);

drop policy if exists saving_record_names_select on public.saving_record_names;
create policy saving_record_names_select on public.saving_record_names
  for select to authenticated using (public.in_saving_circle());

drop policy if exists saving_record_names_insert on public.saving_record_names;
create policy saving_record_names_insert on public.saving_record_names
  for insert to authenticated with check (public.in_saving_circle());

drop policy if exists saving_record_names_update on public.saving_record_names;
create policy saving_record_names_update on public.saving_record_names
  for update to authenticated
  using (public.in_saving_circle()) with check (public.in_saving_circle());

drop policy if exists saving_record_names_delete on public.saving_record_names;
create policy saving_record_names_delete on public.saving_record_names
  for delete to authenticated using (public.in_saving_circle());

drop trigger if exists saving_record_names_touch_updated_at on public.saving_record_names;
create trigger saving_record_names_touch_updated_at
  before update on public.saving_record_names
  for each row execute function public.touch_updated_at();

-- いま使われている記録名を、そのまま候補にする
insert into public.saving_record_names (name, sort_order)
select distinct e.title, 100
from public.saving_entries e
where e.kind = 'custom' and btrim(e.title) <> ''
on conflict (name) do nothing;

-- ----------------------------------------------------------------------------
-- 4. 自動登録が書く内容
-- ----------------------------------------------------------------------------
-- npb_milestones は record_label / holder / uniform_number を別々に持っている。
-- 見出しを1本の文字列で持つのをやめ、記録名だけを持たせる
alter table public.npb_milestones
  add column if not exists record_title text not null default '';

comment on column public.npb_milestones.record_title is
  '記録名（通算250セーブ記念 など）。見出しは背番号・選手名と組み立てる';

-- いま入っているぶんを埋める。通算記録は「通算」を付ける（球団は付けない）
update public.npb_milestones
set record_title = case
  when source = 'career' and kind <> 'team' then '通算' || record_label || '記念'
  else record_label || '記念'
end
where record_title = '';

-- ----------------------------------------------------------------------------
-- 5. 積立を作る関数を、新しい列に合わせる
-- ----------------------------------------------------------------------------
-- 球団の記録は「誰が」を持たない。holder は球団名なので写さない。
-- 選手は姓だけにする（lib/npb/milestones.ts の familyName と同じ扱い）。
-- 名鑑は全角の空白、記録のページは半角と揺れるので、どちらも区切りとみなす
create or replace function public.milestone_player_name(m public.npb_milestones)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case
    when m.kind = 'team' then ''
    else split_part(btrim(regexp_replace(m.holder, '(\s|　)+', ' ', 'g')), ' ', 1)
  end;
$function$;

-- 同じ記録を二度入れない見分けも、1行の文字列から列の組み合わせに変える。
-- 文字列は書き方を変えた瞬間に突き合わせが外れる
create or replace function public.sync_saving_entry_for_milestone(p_milestone_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
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

  select e.custom_group_id into gid
  from public.saving_entries e
  where e.kind = 'custom'
    and e.scene = m.tier
    and e.title = m.record_title
    and e.player_name = public.milestone_player_name(m)
  limit 1;

  if gid is null then
    gid := gen_random_uuid();
  end if;

  for u in select public.saving_target_users() loop
    insert into public.saving_entries (
      user_id, game_id, kind, scene, title, uniform_number, player_name,
      entry_date, amount, breakdown, other_amount, other_note, custom_group_id
    )
    select u, null, 'custom', m.tier, m.record_title,
           case when m.kind = 'team' then '' else m.uniform_number end,
           public.milestone_player_name(m),
           m.achieved_on, amt,
           jsonb_build_array(
             jsonb_build_object('key', 'custom', 'label', m.tier, 'amount', amt)
           ),
           0, '', gid
    where not exists (
      select 1
      from public.saving_entries e
      where e.user_id = u
        and e.kind = 'custom'
        and e.scene = m.tier
        and e.title = m.record_title
        and e.player_name = public.milestone_player_name(m)
    );

    if found then
      made := made + 1;
      perform public.resync_confirmed_amount(u, to_char(m.achieved_on, 'YYYY-MM'));
    end if;
  end loop;

  return made;
end;
$function$;

-- 記録名も候補に足しておく。手で入れるときに選べるようにする
insert into public.saving_record_names (name, sort_order)
select distinct record_title, 100
from public.npb_milestones
where btrim(record_title) <> ''
on conflict (name) do nothing;
