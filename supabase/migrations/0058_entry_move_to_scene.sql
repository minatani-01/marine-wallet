-- ============================================================================
-- Marine Wallet / 0058_entry_move_to_scene
-- ----------------------------------------------------------------------------
-- 0057 で足した列へ、いま入っているカスタム登録を移す。
--
-- これまで、手で入れるぶんは定型のラベルを title に、「#51 山口 逆転サヨナラHR」
-- を手でメモ欄に書いていた。自動で入るぶんも同じ形（title=名球会記録、
-- メモ=#52益田 通算250セーブ記念）だったので、箱の名前を付け直すだけで揃う。
--
--   title（定型のラベル） → scene（名場面）
--   メモの1行           → uniform_number / player_name / title（記録名）
--   メモ                → 備考として空にする
--
-- 元の1行は legacy_note に残す。読み分けを間違えたときに戻せるようにする。
-- 本番の実データ13種類すべてで、正しく分かれることを確かめてある。
--
-- ここは保存済みの行を書き換える。0057（列と表を足すだけ）と分けてあるので、
-- 片方だけを流すこともできる。
--
-- 冪等性: 何度実行しても安全（scene が入っている行は対象外になる）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. メモの1行を、背番号・選手名・記録名に分ける
-- ----------------------------------------------------------------------------
-- 正規表現は lib/saving-label.ts の parseLegacyNote と同じ読み分けにしてある。
update public.saving_entries e
set
  -- 名場面は5つで固定（lib/saving-label.ts の SCENES）。
  -- 「サヨナラ打（HR）」のような具体の出来事は名場面ではないので、
  -- まとめて「名場面」に入れる。何があったかはメモの1行のほうに書いてある
  scene = case
    when e.title in ('シーズン記録', '生涯記録', '名球会記録', '球団記録') then e.title
    else '名場面'
  end,
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
  -- 読み分けを間違えたときに戻せるよう、元の1行をそのまま残す
  legacy_note = btrim(e.other_note),
  other_note = ''
where e.kind = 'custom'
  and e.scene = ''
  and btrim(coalesce(e.other_note, '')) <> '';

-- メモが空だった手入力ぶん。残すものが無いので legacy_note は空のままでよい。
-- 定型のラベルが記録の種類なら名場面へ、そうでなければ記録名として残す
-- （「完全試合」は名場面ではなく、何があったかの名前である）
update public.saving_entries
set
  scene = case
    when title in ('シーズン記録', '生涯記録', '名球会記録', '球団記録') then title
    else '名場面'
  end,
  title = case
    when title in ('シーズン記録', '生涯記録', '名球会記録', '球団記録') then ''
    else title
  end
where kind = 'custom' and scene = '' and btrim(coalesce(other_note, '')) = '';

-- ----------------------------------------------------------------------------
-- 2. 自動登録が持つ記録名
-- ----------------------------------------------------------------------------
-- 通算記録には「通算」を付ける。球団の記録には付けない
-- （lib/npb/milestones.ts の milestoneTitle と同じ組み立て方）
update public.npb_milestones
set record_title = case
  when source = 'career' and kind <> 'team' then '通算' || record_label || '記念'
  else record_label || '記念'
end
where record_title = '';

-- ----------------------------------------------------------------------------
-- 3. 記録名の候補を、いま使われているものから作る
-- ----------------------------------------------------------------------------
-- これまで「カスタム登録の定型」に並べていたもののうち、記録の種類ではないもの。
-- これは名場面ではなく記録名なので、金額ごと記録名の候補へ移す
insert into public.saving_record_names (name, amount, sort_order)
select p.label, p.amount, p.sort_order
from public.saving_custom_presets p
where not p.auto
  and p.label not in ('名場面', 'シーズン記録', '生涯記録', '名球会記録', '球団記録')
on conflict (name) do nothing;

delete from public.saving_custom_presets
where not auto
  and label not in ('名場面', 'シーズン記録', '生涯記録', '名球会記録', '球団記録');

-- 名場面そのものの金額を置く行。無ければ作る
insert into public.saving_custom_presets (label, amount, sort_order, auto)
select '名場面', 100, 10, false
where not exists (select 1 from public.saving_custom_presets where label = '名場面');

-- いま使われている記録名。金額は入れない（名場面や記録名ごとに違う）
insert into public.saving_record_names (name, amount, sort_order)
select distinct e.title, 0, 100
from public.saving_entries e
where e.kind = 'custom' and btrim(e.title) <> ''
on conflict (name) do nothing;

insert into public.saving_record_names (name, amount, sort_order)
select distinct record_title, 0, 100
from public.npb_milestones
where btrim(record_title) <> ''
on conflict (name) do nothing;

-- ----------------------------------------------------------------------------
-- 4. 積立を作る関数を、新しい列に合わせる
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
