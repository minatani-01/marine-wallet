-- ============================================================================
-- Marine Wallet / 0064_reform
-- ----------------------------------------------------------------------------
-- からだの記録（RE:FORM / /body）。
--
-- Google Apps Script の「RE:FORM」をこちらへ移す。スプレッドシートを正本に
-- するのをやめ、アプリの中で付けられるようにする。移すものは9枚ぶん。
--
--   Profile           身長・体重・年齢・目的・目標体重・マシンの刻み
--   Weights           日ごとの体重（1日1行）
--   WorkoutSessions   マシンのワークアウト1回ぶん
--   WorkoutExercises  その中の種目ごとの予定と実績
--   FreeWeights       フリーウェイト
--   Sauna             サウナ
--   HairRemoval       脱毛
--   Esthetic          エステ
--   Whitening         ホワイトニング
--
-- 脱毛・エステ・ホワイトニングは1枚にまとめた（body_care_logs）。入れる項目が
-- ほとんど同じで、画面も履歴も並べて出す。3枚に分けると、同じ列を3回書き、
-- 読むときに3回問い合わせることになる。
--
-- サウナは分けてある。温度・湿度・水温・ロウリュと、他には無い列が10ほど
-- あり、まとめると空の列ばかりになる。
--
-- 自分の行だけを扱う。からだは二人で足し合わせる数字ではないので、
-- オートファジー（0053）と同じく持ち主で絞る。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. プロフィール
-- ----------------------------------------------------------------------------
-- 1人1行。負荷の計算に使うので、身長・体重・年齢は必ず入れてもらう
create table if not exists public.body_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  /** cm */
  height numeric(5, 1) not null,
  /** kg。日ごとの体重は body_weights に入る。ここは設定した時点のもの */
  weight numeric(5, 1) not null,
  age integer not null,
  /** diet / muscle / fitness / health */
  goal text not null default 'health',
  target_weight numeric(5, 1),
  /** マシンの重量の刻み（kg）。2.5 か 5 */
  increment numeric(4, 1) not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.body_profiles is
  'からだの基本データ。ワークアウトの初回負荷を出すのに使う（0064）';

alter table public.body_profiles enable row level security;

-- ----------------------------------------------------------------------------
-- 2. 体重
-- ----------------------------------------------------------------------------
-- 1日1行にする。同じ日に何度量っても最後のものが残るようにしたいので、
-- (user_id, date) で一意にして upsert で入れる
create table if not exists public.body_weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  weight numeric(5, 1) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);

comment on table public.body_weights is '日ごとの体重。1日1行（0064）';

create index if not exists body_weights_user_date_idx
  on public.body_weights (user_id, date desc);

alter table public.body_weights enable row level security;

-- ----------------------------------------------------------------------------
-- 3. ワークアウト（マシン）
-- ----------------------------------------------------------------------------
create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  /** かかった時間（分）。開始から完了までを数える */
  duration integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.workout_sessions is 'マシンのワークアウト1回ぶん（0064）';

create index if not exists workout_sessions_user_date_idx
  on public.workout_sessions (user_id, date desc);

alter table public.workout_sessions enable row level security;

-- 種目ごとの予定と実績。次回の負荷はこの実績から決まるので、
-- 予定（target）も残す。予定どおりだったのか、届かなかったのかが後で分かる
create table if not exists public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions (id) on delete cascade,
  /** RLS で毎回 session を辿らずに済むよう持たせる */
  user_id uuid not null references auth.users (id) on delete cascade,
  /** leg_press など。種目の並びは lib/reform.ts が持つ */
  exercise_id text not null,
  name text not null,
  /** strength / bodyweight / cardio */
  kind text not null,
  target_weight numeric(6, 1),
  actual_weight numeric(6, 1),
  target_reps integer,
  /** セットごとの実施回数。[10, 10, 8] のように入る */
  actual_reps jsonb not null default '[]'::jsonb,
  target_sets integer,
  target_minutes integer,
  actual_minutes integer,
  /** easy / normal / hard / max */
  effort text not null default 'normal',
  /** その負荷にした理由。画面にそのまま出す */
  reason text not null default '',
  /** 画面に出す順。種目の並びを保つ */
  position integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.workout_exercises is
  'ワークアウトの種目ごとの予定と実績。次回の負荷はここから決まる（0064）';

create index if not exists workout_exercises_session_idx
  on public.workout_exercises (session_id, position);
create index if not exists workout_exercises_user_ex_idx
  on public.workout_exercises (user_id, exercise_id);

alter table public.workout_exercises enable row level security;

-- ----------------------------------------------------------------------------
-- 4. フリーウェイト
-- ----------------------------------------------------------------------------
-- マシンと混ぜない。こちらは自動で負荷を上げず、やったことだけを残す
create table if not exists public.free_weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  exercise text not null,
  equipment text not null default '',
  weight numeric(6, 1) not null default 0,
  reps integer not null default 0,
  sets integer not null default 0,
  effort text not null default 'normal',
  note text not null default '',
  created_at timestamptz not null default now()
);

comment on table public.free_weight_logs is 'フリーウェイトの記録（0064）';

create index if not exists free_weight_logs_user_date_idx
  on public.free_weight_logs (user_id, date desc);

alter table public.free_weight_logs enable row level security;

-- ----------------------------------------------------------------------------
-- 5. サウナ
-- ----------------------------------------------------------------------------
create table if not exists public.sauna_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  /** ドライサウナ / フィンランド式 など */
  kind text not null default '',
  /** 表示が無い施設もあるので null を許す */
  temperature numeric(4, 1),
  humidity numeric(4, 1),
  /** 1セットあたりの分 */
  sauna_minutes numeric(4, 1) not null,
  sets integer not null default 1,
  cooling_method text not null default '',
  cooling_minutes numeric(4, 1),
  water_temperature numeric(4, 1),
  rest_minutes numeric(4, 1),
  loyly boolean not null default false,
  loyly_count integer not null default 0,
  /** 終わったときの体調。無理をした日が後から分かるように残す */
  condition text not null default '',
  water_ml integer,
  note text not null default '',
  created_at timestamptz not null default now()
);

comment on table public.sauna_logs is
  'サウナの記録。自動で負荷を上げることはしない（0064）';

create index if not exists sauna_logs_user_date_idx
  on public.sauna_logs (user_id, date desc);

alter table public.sauna_logs enable row level security;

-- ----------------------------------------------------------------------------
-- 6. ケア（脱毛・エステ・ホワイトニング）
-- ----------------------------------------------------------------------------
-- 3つを1枚にまとめる。使う列は kind で変わる
--
--   hair       part / minutes / level / skin
--   esthetic   part / minutes
--   whitening  minutes / count
create table if not exists public.body_care_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('hair', 'esthetic', 'whitening')),
  part text not null default '',
  minutes integer not null default 0,
  /** 照射レベル。記録しないこともあるので数値にしない */
  level text not null default '',
  skin text not null default '',
  /** ホワイトニングの実施回数 */
  count integer not null default 1,
  note text not null default '',
  created_at timestamptz not null default now()
);

comment on table public.body_care_logs is
  '脱毛・エステ・ホワイトニングの記録。kind で使う列が変わる（0064）';

create index if not exists body_care_logs_user_idx
  on public.body_care_logs (user_id, kind, date desc);

alter table public.body_care_logs enable row level security;

-- ----------------------------------------------------------------------------
-- 7. 見え方。自分の行だけを扱える
-- ----------------------------------------------------------------------------
-- 7枚とも同じ形だが、ループで回さず1枚ずつ書く。読むときに、どの表に何が
-- 当たっているかが grep で分かるほうがよい。

drop policy if exists body_profiles_select_own on public.body_profiles;
create policy body_profiles_select_own on public.body_profiles
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists body_profiles_insert_own on public.body_profiles;
create policy body_profiles_insert_own on public.body_profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists body_profiles_update_own on public.body_profiles;
create policy body_profiles_update_own on public.body_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists body_profiles_delete_own on public.body_profiles;
create policy body_profiles_delete_own on public.body_profiles
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists body_weights_select_own on public.body_weights;
create policy body_weights_select_own on public.body_weights
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists body_weights_insert_own on public.body_weights;
create policy body_weights_insert_own on public.body_weights
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists body_weights_update_own on public.body_weights;
create policy body_weights_update_own on public.body_weights
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists body_weights_delete_own on public.body_weights;
create policy body_weights_delete_own on public.body_weights
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists workout_sessions_select_own on public.workout_sessions;
create policy workout_sessions_select_own on public.workout_sessions
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists workout_sessions_insert_own on public.workout_sessions;
create policy workout_sessions_insert_own on public.workout_sessions
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists workout_sessions_update_own on public.workout_sessions;
create policy workout_sessions_update_own on public.workout_sessions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists workout_sessions_delete_own on public.workout_sessions;
create policy workout_sessions_delete_own on public.workout_sessions
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists workout_exercises_select_own on public.workout_exercises;
create policy workout_exercises_select_own on public.workout_exercises
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists workout_exercises_insert_own on public.workout_exercises;
create policy workout_exercises_insert_own on public.workout_exercises
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists workout_exercises_update_own on public.workout_exercises;
create policy workout_exercises_update_own on public.workout_exercises
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists workout_exercises_delete_own on public.workout_exercises;
create policy workout_exercises_delete_own on public.workout_exercises
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists free_weight_logs_select_own on public.free_weight_logs;
create policy free_weight_logs_select_own on public.free_weight_logs
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists free_weight_logs_insert_own on public.free_weight_logs;
create policy free_weight_logs_insert_own on public.free_weight_logs
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists free_weight_logs_update_own on public.free_weight_logs;
create policy free_weight_logs_update_own on public.free_weight_logs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists free_weight_logs_delete_own on public.free_weight_logs;
create policy free_weight_logs_delete_own on public.free_weight_logs
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists sauna_logs_select_own on public.sauna_logs;
create policy sauna_logs_select_own on public.sauna_logs
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists sauna_logs_insert_own on public.sauna_logs;
create policy sauna_logs_insert_own on public.sauna_logs
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists sauna_logs_update_own on public.sauna_logs;
create policy sauna_logs_update_own on public.sauna_logs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists sauna_logs_delete_own on public.sauna_logs;
create policy sauna_logs_delete_own on public.sauna_logs
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists body_care_logs_select_own on public.body_care_logs;
create policy body_care_logs_select_own on public.body_care_logs
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists body_care_logs_insert_own on public.body_care_logs;
create policy body_care_logs_insert_own on public.body_care_logs
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists body_care_logs_update_own on public.body_care_logs;
create policy body_care_logs_update_own on public.body_care_logs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists body_care_logs_delete_own on public.body_care_logs;
create policy body_care_logs_delete_own on public.body_care_logs
  for delete to authenticated using (user_id = (select auth.uid()));

-- 直したときに updated_at を進める。持っている表だけに当てる
drop trigger if exists body_profiles_touch_updated_at on public.body_profiles;
create trigger body_profiles_touch_updated_at
  before update on public.body_profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists body_weights_touch_updated_at on public.body_weights;
create trigger body_weights_touch_updated_at
  before update on public.body_weights
  for each row execute function public.touch_updated_at();
