-- ============================================================================
-- Marine Wallet / 0065_subscriptions
-- ----------------------------------------------------------------------------
-- サブスクの管理（/subs）。
--
-- 毎月いくら出ていくかと、次にいつ落ちるかを置いておく。少額のものが
-- 積み上がって、合計が分からなくなるのを避けるため。
--
-- 止めたものは消さない（active を false にする）。「前に解約したはず」を
-- 後から確かめられるようにする。消すと、また同じものを申し込んだときに
-- 気づけない。
--
-- 自分の行だけを扱う。払っているものは人それぞれで、割り勘や貯金の計算にも
-- 入れない。オートファジー（0053）やからだ（0064）と同じく持ち主で絞る。
--
-- 支払日の持ち方。
--
--   毎月  billing_day だけを見る（1〜31）
--   毎年  billing_month と billing_day の両方を見る
--
-- 31日を指定しても構わない。その月に無い日は末日へ寄せる（lib/subscriptions）。
-- 日付そのものを持たないのは、毎月書き換える手間を増やさないため。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  /** 1回の請求額（円） */
  amount integer not null default 0,
  /** monthly / yearly */
  cycle text not null default 'monthly' check (cycle in ('monthly', 'yearly')),
  /** 支払日（1〜31）。その月に無い日は画面側で末日に寄せる */
  billing_day integer not null default 1 check (billing_day between 1 and 31),
  /** 毎年のときだけ使う（1〜12） */
  billing_month integer check (billing_month between 1 and 12),
  category text not null default 'その他',
  /** 支払い方法。カード名など */
  method text not null default '',
  /** 解約・管理のページ */
  url text not null default '',
  note text not null default '',
  /** いつから使っているか。任意 */
  started_on date,
  /** 止めたものは false。消さずに残す */
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.subscriptions is
  'サブスクの一覧。止めたものも残す（0065）';
comment on column public.subscriptions.billing_day is
  '支払日（1〜31）。その月に無い日は末日へ寄せる';
comment on column public.subscriptions.billing_month is
  '毎年のときの支払月（1〜12）。毎月のときは null';

create index if not exists subscriptions_user_idx
  on public.subscriptions (user_id, active, billing_day);

alter table public.subscriptions enable row level security;

-- ----------------------------------------------------------------------------
-- 見え方。自分の行だけを扱える
-- ----------------------------------------------------------------------------
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists subscriptions_insert_own on public.subscriptions;
create policy subscriptions_insert_own on public.subscriptions
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists subscriptions_update_own on public.subscriptions;
create policy subscriptions_update_own on public.subscriptions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists subscriptions_delete_own on public.subscriptions;
create policy subscriptions_delete_own on public.subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

drop trigger if exists subscriptions_touch_updated_at on public.subscriptions;
create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();
