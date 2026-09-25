-- ============================================================================
-- Marine Wallet / 0053_autophagy
-- ----------------------------------------------------------------------------
-- オートファジー（1日のうち食べない時間を作る）の設定。
--
-- ダイエット・美容・トレーニングをまとめた画面（からだ）の1つめの機能。
-- 食べてよい時間を決めておき、その始まりと終わりに通知する。
--
-- 人ごとに1行持つ。貯金や割り勘と違って共有するものではない。
-- 食事の時間は体調にも予定にも寄るもので、相手に合わせるものではない。
--
-- 時刻は time で持ち、日付は持たない。毎日同じ時間を繰り返すだけなので、
-- 日付を持つと毎日行が増えていく。時差は日本時間に決め打ちする
-- （lib/autophagy.ts の jstMinutes と揃える）。海外に行ったときに
-- ずれるが、そのときは設定の時刻を直せば済む。
--
-- 終わりが始まりより小さいときは日をまたぐ。18:00〜翌2:00 のような
-- 指定がふつうなので、制約でそれを禁じない。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

create table if not exists public.autophagy_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,

  /** 通知を含めて、この機能を使うかどうか */
  enabled boolean not null default true,

  /** 食べてよい時間の始まり（日本時間） */
  eat_start time not null default '18:00',
  /** 食べてよい時間の終わり（日本時間）。始まりより小さいときは翌日 */
  eat_end time not null default '02:00',

  /** 食べてよい時間になったことを知らせるか */
  notify_eat boolean not null default true,
  /** 食べない時間になったことを知らせるか */
  notify_fast boolean not null default true,

  /**
   * 最後に通知した境目。
   *
   * 送る仕組みは境目のあと数分のあいだ繰り返し見に来るので、
   * これが無いと同じ境目で何度も鳴る。
   */
  last_notified_at timestamptz,
  /** 最後に通知したのがどちらの境目か（'eat' / 'fast'） */
  last_notified_kind text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.autophagy_settings enable row level security;

comment on table public.autophagy_settings is
  'オートファジーの設定。人ごとに1行。共有しない';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'autophagy_kind_check') then
    alter table public.autophagy_settings
      add constraint autophagy_kind_check
      check (last_notified_kind is null or last_notified_kind in ('eat', 'fast'));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 見え方。自分の行だけを扱える
-- ----------------------------------------------------------------------------
-- 送信は service role で行うため、通知の仕組みからは RLS を迂回して全員分を引ける。
drop policy if exists autophagy_settings_select_own on public.autophagy_settings;
create policy autophagy_settings_select_own on public.autophagy_settings
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists autophagy_settings_insert_own on public.autophagy_settings;
create policy autophagy_settings_insert_own on public.autophagy_settings
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists autophagy_settings_update_own on public.autophagy_settings;
create policy autophagy_settings_update_own on public.autophagy_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists autophagy_settings_delete_own on public.autophagy_settings;
create policy autophagy_settings_delete_own on public.autophagy_settings
  for delete to authenticated using (user_id = (select auth.uid()));

drop trigger if exists autophagy_settings_touch_updated_at on public.autophagy_settings;
create trigger autophagy_settings_touch_updated_at
  before update on public.autophagy_settings
  for each row execute function public.touch_updated_at();
