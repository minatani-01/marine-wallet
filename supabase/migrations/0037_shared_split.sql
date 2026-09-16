-- ============================================================================
-- Marine Wallet / 0037_shared_split
-- ----------------------------------------------------------------------------
-- 割り勘を全員で共有する。
--
-- これまで割り勘は各自の持ち物で、相手の記録は「共有されている割り勘」として
-- 読むだけだった。精算に必要な額もメンバーごとの金額も自分の記録からしか
-- 計算しないので、自分で登録していない人の画面は全て0円になっていた。
--
-- 割り勘は「誰が立て替えて誰が負担するか」という、その場に居た全員の話で、
-- 人によって中身が変わるものではない。試合やカスタム登録と同じく、
-- 1つのデータを全員で見て、全員が触れる形にする。
--
-- 持ち主はマスターのまま（行は動かさない）。マスターが割り勘の共有を許可した
-- 接続相手に、マスターの行への読み書きを開ける。許可していない相手には
-- 今までどおり見えない。
--
-- 「あなた」が誰かは見る人によって変わるので、DB には持たせない。
-- split_members.marine_id と見ている人の Marine ID を突き合わせて画面側で決める。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 共有の割り勘の持ち主
-- ----------------------------------------------------------------------------
-- 貯金の saving_target_users() と同じ考え方。輪の中心はマスター1人なので、
-- ここでは「マスターの id」を返すだけでよい。
create or replace function public.split_owner()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select p.id from public.profiles p where p.is_master order by p.id limit 1;
$function$;

revoke all on function public.split_owner() from public, anon;
grant execute on function public.split_owner() to authenticated;

-- ----------------------------------------------------------------------------
-- 2. その行を読み書きしてよいか
-- ----------------------------------------------------------------------------
-- 自分の行か、マスターの行で割り勘の共有を許可されているか。
-- 許可の判定は今までと同じ marine_link_allows に任せる。
create or replace function public.split_row_allowed(p_owner uuid)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select p_owner = (select auth.uid())
      or (p_owner = public.split_owner() and public.marine_link_allows(p_owner, 'split'));
$function$;

revoke all on function public.split_row_allowed(uuid) from public, anon;
grant execute on function public.split_row_allowed(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. 支出
-- ----------------------------------------------------------------------------
-- これまでの records_select_shared_member は、レコードの shares に自分の名前が
-- 入っているものだけを読ませていた。移行した古い記録は shares が空なので
-- 1件も見えなかった。共有の単位をレコードから輪へ移すので、この形はやめる。
drop policy if exists records_select_own on public.records;
drop policy if exists records_select_shared_member on public.records;
drop policy if exists records_insert_own on public.records;
drop policy if exists records_update_own on public.records;
drop policy if exists records_delete_own on public.records;

create policy records_select_shared on public.records
  for select to authenticated using (public.split_row_allowed(user_id));

create policy records_insert_shared on public.records
  for insert to authenticated with check (public.split_row_allowed(user_id));

create policy records_update_shared on public.records
  for update to authenticated
  using (public.split_row_allowed(user_id))
  with check (public.split_row_allowed(user_id));

create policy records_delete_shared on public.records
  for delete to authenticated using (public.split_row_allowed(user_id));

-- ----------------------------------------------------------------------------
-- 4. メンバー
-- ----------------------------------------------------------------------------
-- 支出の負担はメンバー名で書いてあるので、メンバーも一緒に共有しないと
-- 誰の負担か引けない。
drop policy if exists split_members_select_own on public.split_members;
drop policy if exists split_members_insert_own on public.split_members;
drop policy if exists split_members_update_own on public.split_members;
drop policy if exists split_members_delete_own on public.split_members;

create policy split_members_select_shared on public.split_members
  for select to authenticated using (public.split_row_allowed(user_id));

create policy split_members_insert_shared on public.split_members
  for insert to authenticated with check (public.split_row_allowed(user_id));

create policy split_members_update_shared on public.split_members
  for update to authenticated
  using (public.split_row_allowed(user_id))
  with check (public.split_row_allowed(user_id));

create policy split_members_delete_shared on public.split_members
  for delete to authenticated using (public.split_row_allowed(user_id));

-- split_record_shared_with_me はもう使わないが、残しても害がないので置いておく。
-- 消すと、古いビルドが動いている端末から読めなくなる瞬間ができる。
