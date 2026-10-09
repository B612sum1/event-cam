-- =====================================================================
-- 002: 一覧用サムネイル（小さい見本の写真）に対応
-- Supabase ダッシュボード > SQL Editor に丸ごと貼り付けて実行してください。
-- 何度実行しても問題ありません。
-- =====================================================================

-- 1. photos にサムネイルの保存場所を追加（以前の写真は NULL のまま＝元の写真で表示）
alter table public.photos add column if not exists thumb_path text unique;

-- 2. 写真の記録を作れる条件：サムネイルも自分の名前のファイルであること
drop policy if exists photos_insert on public.photos;
create policy photos_insert on public.photos for insert to authenticated
  with check (
    public.owns_guest(guest_id)
    and starts_with(storage_path, event_id::text || '/' || guest_id::text || '_')
    and (thumb_path is null or starts_with(thumb_path, event_id::text || '/' || guest_id::text || '_'))
  );

-- 3. 保存先の閲覧：元の写真に加えてサムネイルも、photos で「見える」写真だけ
drop policy if exists event_photos_select on storage.objects;
create policy event_photos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'event-photos'
    and exists (
      select 1 from public.photos p
      where p.storage_path = name or p.thumb_path = name
    )
  );

-- 4. 保存先の削除：本人、または主催者（サムネイルも含む）
drop policy if exists event_photos_delete on storage.objects;
create policy event_photos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'event-photos'
    and (
      owner_id = (select auth.uid())::text
      or exists (
        select 1 from public.photos p
        where (p.storage_path = name or p.thumb_path = name)
          and public.is_event_owner(p.event_id)
      )
    )
  );
