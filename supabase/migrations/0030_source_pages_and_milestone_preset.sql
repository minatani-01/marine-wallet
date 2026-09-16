-- ============================================================================
-- Marine Wallet / 0030_source_pages_and_milestone_preset
-- ----------------------------------------------------------------------------
-- 1. 取得ページの置き場を、記録以外も入る名前に直す
--
-- 0029 で npb_milestone_pages を作ったが、記録達成を「#51山口」の形で
-- 書くには背番号が要る。記録のページにも成績のスナップショットにも
-- 背番号は無く、選手名鑑から取るしかない。記録のページ専用の名前だと
-- 名鑑を入れる場所が無くなるので、取得ページ全般の置き場に改める。
--
-- 2. カスタム登録の定型に「記録達成」を足す
--
-- 自動登録はこの定型の金額を使う。金額を貯金ルールの画面から変えられる
-- ようにしておくと、変えるたびに手を入れずに済む。
-- 既存の「メモリアル」は手入力で使い続けられるよう残す。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

alter table if exists public.npb_milestone_pages rename to npb_source_pages;

comment on table public.npb_source_pages is
  'npb.jp から取ったページの原文。記録達成の判定と背番号の引き当てに使う';

comment on column public.npb_source_pages.kind is
  'milestone_batting / milestone_pitching / milestone_team / roster';

-- 0029 で入れた記録ページは種類の名前が変わる。名鑑は次の取得で入る
update public.npb_source_pages set kind = 'milestone_batting' where kind = 'batting';
update public.npb_source_pages set kind = 'milestone_pitching' where kind = 'pitching';
update public.npb_source_pages set kind = 'milestone_team' where kind = 'team';

-- 自動登録が使う定型。金額は貯金ルールの画面から変えられる
insert into public.saving_custom_presets (label, amount, sort_order)
values ('記録達成', 1000, 50)
on conflict (label) do nothing;
