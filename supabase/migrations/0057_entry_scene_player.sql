-- ============================================================================
-- Marine Wallet / 0057_entry_scene_player
-- ----------------------------------------------------------------------------
-- カスタム登録を5つの項目にそろえるための、入れ物だけを用意する。
--
--   1 名場面     saving_entries.scene（金額は saving_custom_presets が持つ）
--   2 記録名     saving_entries.title
--   3 背番号・選手名  uniform_number / player_name
--   4 金額       amount
--   5 備考       other_note
--
-- ここでは列と表を足すだけで、いま入っているデータには一切触れない。
-- 既にあるカスタム登録を新しい列へ移すのは 0058 で行う。足すのと移すのを
-- 1つにまとめると、止めたいときに両方とも止めることになる。
--
-- 自動で入るぶん（npb.jp）と手で入れるぶんで、見出しを同じ形にしたい。
-- 別々に組み立てると「#52益田」と「#51 山口」のように書き方がずれる。
-- 組み立ては lib/saving-label.ts にまとめてある。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 積立の列
-- ----------------------------------------------------------------------------
alter table public.saving_entries
  add column if not exists scene text not null default '',
  add column if not exists uniform_number text not null default '',
  add column if not exists player_name text not null default '',
  add column if not exists legacy_note text not null default '';

comment on column public.saving_entries.scene is
  '名場面。好プレー / 名球会記録 など。saving_custom_presets.label と揃える';
comment on column public.saving_entries.uniform_number is
  '背番号。入っていれば選手の記録、空なら球団の記録';
comment on column public.saving_entries.player_name is
  '選手名。背番号が分からない昔の選手は、これだけ入ることもある';
comment on column public.saving_entries.legacy_note is
  '0058 より前にメモ欄へ書いてあった1行。読み分けを間違えたときに戻せるよう残す';

-- ----------------------------------------------------------------------------
-- 2. 記録名の候補
-- ----------------------------------------------------------------------------
-- 名場面の候補は saving_custom_presets がそのまま使える（貯金ルールの画面で
-- 足せる）。記録名はここに持つ。登録のときに一覧に無い言葉を書くと増える。
--
-- 共有のもの。貯金のリストと同じで、人によって変わらない。
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

-- ----------------------------------------------------------------------------
-- 3. 自動登録が持つ記録名
-- ----------------------------------------------------------------------------
-- npb_milestones は record_label / holder / uniform_number を別々に持っている。
-- 見出しを1本の文字列（title）で持つのをやめ、記録名だけを別に持たせる。
-- 中身を入れるのは 0058。
alter table public.npb_milestones
  add column if not exists record_title text not null default '';

comment on column public.npb_milestones.record_title is
  '記録名（通算250セーブ記念 など）。見出しは背番号・選手名と組み立てる';
