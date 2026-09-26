-- ============================================================================
-- Marine Wallet / 0055_record_receipt
-- ----------------------------------------------------------------------------
-- 割り勘の記録に、領収書や決済画面の写真を1枚つけられるようにする。
--
--   records.receipt_path  … Storage 上のオブジェクトパス
--   storage bucket receipts … 写真の実体
--
-- 「2,705円」とだけ残っていても、あとから見て何の支払いだったのか分からない
-- ことがある。決済画面のスクリーンショットが1枚あれば、店名も日時も
-- ポイントの付き方もそこに写っている。読み取って文字にするより、
-- そのまま残すほうが確かで、手間も費用もかからない。
--
-- 1件につき1枚にする。レシートと決済画面の両方を残したくなることはあるが、
-- 複数にすると並べ方も消し方も要る。まず1枚で始める。
--
-- バケットは非公開にする。店名・日時・金額が写っていて、URLを知っていれば
-- 誰でも見られる状態にはしたくない。表示のたびにサーバー側で署名付きURLを
-- 発行する（0010 のアイコンと同じ扱い）。
--
-- 読むのは貯金を共にしている人まで広げる。割り勘は二人のもので、相手が
-- 立替えた支払いの領収書を自分が見られないのでは意味がない。
-- 書き込みと削除は自分のフォルダだけにする。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

alter table public.records
  add column if not exists receipt_path text;

comment on column public.records.receipt_path is
  'receipts バケット上のパス。領収書や決済画面の写真。null なら添付なし';

-- ----------------------------------------------------------------------------
-- バケット
-- ----------------------------------------------------------------------------
-- public=false。上げる前にブラウザ側で長辺1400pxの JPEG に縮めるので、
-- 2MB は変換を通さない経路への保険である。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
drop policy if exists "receipts_select_circle" on storage.objects;
drop policy if exists "receipts_insert_own" on storage.objects;
drop policy if exists "receipts_update_own" on storage.objects;
drop policy if exists "receipts_delete_own" on storage.objects;

-- 読むのは貯金を共にしている人まで。相手が立替えたぶんの領収書も見られる
create policy "receipts_select_circle"
  on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.in_saving_circle());

-- 書き込みと削除は自分のフォルダだけ
create policy "receipts_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "receipts_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "receipts_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
