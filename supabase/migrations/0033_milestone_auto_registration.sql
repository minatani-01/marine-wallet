-- ============================================================================
-- Marine Wallet / 0033_milestone_auto_registration
-- ----------------------------------------------------------------------------
-- 「名球会記録 / 生涯記録 / シーズン記録」を自動登録へ移す。
--
-- この3つはどれも npb.jp から取れる。
--   通算記録   /history/<年>/milestones_b|p|team.html の「達成済み」の表
--   シーズン記録 /bis/<年>/stats/idb1_m.html・idp1_m.html の個人成績
-- 取れるものを手で選ばせる理由はないので、カスタム登録の定型一覧から外して、
-- 毎朝の取り込みが入れるようにする。
--
-- 定型の行そのものは消さない。金額を貯金ルールの画面から変えられる形は
-- そのまま使いたいし、過去の積立が持つラベルとも揃えておきたい。
-- 代わりに auto の印を立てて、カスタム登録の選択肢には出さない。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 自動登録が使う定型の印
-- ----------------------------------------------------------------------------

alter table public.saving_custom_presets
  add column if not exists auto boolean not null default false;

comment on column public.saving_custom_presets.auto is
  '自動登録が使う定型。カスタム登録の定型一覧には出さず、金額だけ変えられる';

update public.saving_custom_presets
set auto = true
where label in ('名球会記録', '生涯記録', 'シーズン記録');

-- 0031 で入れた3つは sort_order 50/60/70 だが、利用者が足した
-- 「MVP・GG賞・ベストナイン」も 50 にいて並びが重なっている。
-- 自動登録ぶんを後ろへ寄せて、手で選ぶ定型と混ざらないようにする
update public.saving_custom_presets set sort_order = 110 where label = '名球会記録';
update public.saving_custom_presets set sort_order = 120 where label = '生涯記録';
update public.saving_custom_presets set sort_order = 130 where label = 'シーズン記録';

-- ----------------------------------------------------------------------------
-- 2. 達成した記録
-- ----------------------------------------------------------------------------
-- 読み取った結果をここに置く。同じ記録を毎日入れ直さないための台帳でもある。
--
-- 一意キーは (season, source, record_label, holder)。
--   通算記録は一生に一度なので、これで重複しない。
--   シーズン記録は年が変わればまた達成しうるので、season を含める。
--
-- 書けるのは service role だけ。読みは全員に開ける（貯金の裏付けになる）。
create table if not exists public.npb_milestones (
  id uuid primary key default gen_random_uuid(),

  /** 達成した年 */
  season integer not null,

  /** career = 通算記録のページ / season = 個人成績から見つけたシーズン記録 */
  source text not null check (source in ('career', 'season')),

  /** batting / pitching / team */
  kind text not null check (kind in ('batting', 'pitching', 'team')),

  /** npb.jp の見出しそのまま（例: 250セーブ / シーズン30本塁打） */
  record_label text not null,

  /** 達成した人。チーム記録なら球団名 */
  holder text not null,

  /** 背番号。名鑑から引けなければ空 */
  uniform_number text not null default '',

  /** 積立に使う定型のラベル（名球会記録 / 生涯記録 / シーズン記録） */
  tier text not null,

  achieved_on date not null,

  /** 積立に残す内容（例: #52益田 通算250セーブ記念） */
  title text not null,

  created_at timestamptz not null default now(),

  unique (season, source, record_label, holder)
);

alter table public.npb_milestones enable row level security;

comment on table public.npb_milestones is
  'npb.jp から読み取った達成済みの記録。積立を二重に作らないための台帳';

drop policy if exists npb_milestones_select_all on public.npb_milestones;
create policy npb_milestones_select_all on public.npb_milestones
  for select to authenticated using (true);

-- ----------------------------------------------------------------------------
-- 3. 記録から積立を作る
-- ----------------------------------------------------------------------------
-- 金額は定型が持つ。ここに数字を書かないので、貯金ルールの画面で変えた額が
-- そのまま効く。
--
-- 日付の決め方に一手間かけている。記録を見つけるのは達成の翌朝とは限らず、
-- 仕組みを足した後に過去ぶんをまとめて拾うこともある。その月がもう確定・
-- 入金済みだと、達成日に入れた積立は累計に入らない（累計は確定額を足すため）。
-- 確定済みの月に当たったときは、まだ開いている今月へ入れて、内容に達成日を
-- 書き添える。金額が宙に浮くより、月がずれても貯まるほうがよい。
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
  v_date date;
  v_note text;
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
    v_date := m.achieved_on;
    v_note := m.title;

    if exists (
      select 1
      from public.monthly_savings ms
      where ms.user_id = u
        and ms.month = to_char(m.achieved_on, 'YYYY-MM')
        and ms.status <> 'calculating'
    ) then
      v_date := (now() at time zone 'Asia/Tokyo')::date;
      v_note := m.title || '（' || to_char(m.achieved_on, 'YYYY.FMMM.FMDD') || '達成）';
    end if;

    -- 同じ記録を二度入れない。台帳の一意キーで防いでいるが、
    -- 台帳を作り直したときのために積立側でも見ておく
    insert into public.saving_entries (
      user_id, game_id, kind, title, entry_date, amount, breakdown, other_amount, other_note
    )
    select u, null, 'custom', m.tier, v_date, amt,
           jsonb_build_array(
             jsonb_build_object('key', 'custom', 'label', m.tier, 'amount', amt)
           ),
           0, v_note
    where not exists (
      select 1
      from public.saving_entries e
      where e.user_id = u
        and e.kind = 'custom'
        and e.other_note like m.title || '%'
    );

    made := made + (case when found then 1 else 0 end);
  end loop;

  return made;
end;
$function$;

revoke all on function public.sync_saving_entry_for_milestone(uuid) from public, anon;

create or replace function public.npb_milestones_sync_entries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform public.sync_saving_entry_for_milestone(new.id);
  return new;
end;
$function$;

drop trigger if exists npb_milestones_sync_entries on public.npb_milestones;
create trigger npb_milestones_sync_entries
after insert on public.npb_milestones
for each row execute function public.npb_milestones_sync_entries();

-- ----------------------------------------------------------------------------
-- 4. まもなく達成する記録
-- ----------------------------------------------------------------------------
-- ホームに出すカウントダウン。毎朝の取り込みで作り直す。
--
-- 「その年の残り」なので履歴は持たない。取り込みのたびに、その季のぶんを
-- 消してから入れ直す。npb.jp の並びが変わっても古い行が残らない。
--
-- 書けるのは service role だけ。読みは全員に開ける。
create table if not exists public.npb_upcoming_milestones (
  id uuid primary key default gen_random_uuid(),

  season integer not null,

  /** batting / pitching */
  kind text not null check (kind in ('batting', 'pitching')),

  /** npb.jp の見出しそのまま（例: 2000安打） */
  record_label text not null,

  holder text not null,

  /** 背番号。名鑑から引けなければ空 */
  uniform_number text not null default '',

  /** 目標の数と単位（例: 2000 / 安打） */
  target integer not null,
  unit text not null,

  /** 通算（昨年まで + 今季） */
  current integer not null,

  /** あと何本。小さいものから出す */
  remaining integer not null,

  updated_at timestamptz not null default now(),

  unique (season, kind, record_label, holder)
);

alter table public.npb_upcoming_milestones enable row level security;

comment on table public.npb_upcoming_milestones is
  'まもなく達成する記録。ホームのカウントダウンに使う。毎朝作り直す';

create index if not exists npb_upcoming_milestones_remaining_idx
  on public.npb_upcoming_milestones (season, remaining);

drop policy if exists npb_upcoming_milestones_select_all on public.npb_upcoming_milestones;
create policy npb_upcoming_milestones_select_all on public.npb_upcoming_milestones
  for select to authenticated using (true);

-- ----------------------------------------------------------------------------
-- 5. 手で入れたシーズン記録を、自動登録と同じ形に揃える
-- ----------------------------------------------------------------------------
-- 「#51山口 シーズンHR30本達成」は、自動登録なら
-- 「#51山口 シーズン30本塁打記念」になる。書き方が違うと同じ記録だと
-- 分からず、自動登録がもう1件足してしまう。先に揃えておく。
--
-- 金額は変えない。定型「シーズン記録」も 1,000 円なので、月の合計は動かない。
update public.saving_entries
set title = 'シーズン記録',
    other_note = '#51山口 シーズン30本塁打記念',
    breakdown = jsonb_build_array(
      jsonb_build_object('key', 'custom', 'label', 'シーズン記録', 'amount', amount)
    )
where kind = 'custom'
  and other_note = '#51山口 シーズンHR30本達成';
