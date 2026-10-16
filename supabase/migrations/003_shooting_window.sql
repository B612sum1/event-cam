-- =====================================================================
-- 003: 写真を撮れる時間（撮影の開始・終了）
-- Supabase ダッシュボード > SQL Editor に丸ごと貼り付けて実行してください。
-- 何度実行しても問題ありません。
--
-- 判定はすべてサーバー（データベース）の時刻で行うため、
-- スマホの時計をずらしても時間外には撮影できません。
-- 締め切り直前に撮った写真が会場の回線で遅れて届いても受け付けられるよう、
-- 終了時刻から 2 分間だけ猶予を設けています。
-- =====================================================================

-- 1. 撮影の開始・終了（NULL = 制限なし）
alter table public.events add column if not exists shoot_start_at timestamptz;
alter table public.events add column if not exists shoot_end_at timestamptz;

alter table public.events drop constraint if exists events_shoot_window_check;
alter table public.events add constraint events_shoot_window_check
  check (shoot_start_at is null or shoot_end_at is null or shoot_start_at < shoot_end_at);

-- 2. いま撮影できるか（アップロードの許可判定に使う）
create or replace function public.is_shooting_open(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select (e.shoot_start_at is null or e.shoot_start_at <= now())
        and (e.shoot_end_at is null or now() < e.shoot_end_at + interval '2 minutes')
       from public.events e where e.id = p_event_id),
    false
  );
$$;

-- 3. 写真の記録を作るときのチェックに「撮影時間」を追加
create or replace function public.enforce_photo_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_event_id uuid;
  v_max      integer;
  v_start    timestamptz;
  v_end      timestamptz;
  v_count    integer;
begin
  -- 同一ゲストの同時INSERTを直列化
  select g.event_id into v_event_id
    from public.guests g where g.id = new.guest_id
    for update;

  if v_event_id is null or v_event_id <> new.event_id then
    raise exception 'guest_event_mismatch';
  end if;

  select e.max_photos_per_guest, e.shoot_start_at, e.shoot_end_at
    into v_max, v_start, v_end
    from public.events e where e.id = new.event_id;

  if v_start is not null and now() < v_start then
    raise exception 'shooting_not_started';
  end if;
  if v_end is not null and now() >= v_end + interval '2 minutes' then
    raise exception 'shooting_closed';
  end if;

  select count(*) into v_count from public.photos p where p.guest_id = new.guest_id;
  if v_count >= v_max then
    raise exception 'photo_limit_reached';
  end if;

  return new;
end;
$$;

-- 4. 保存先へのアップロードも、撮影時間内だけ許可
drop policy if exists event_photos_insert on storage.objects;
create policy event_photos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'event-photos'
    and exists (
      select 1 from public.guests g
      where g.auth_uid = (select auth.uid())
        and g.event_id::text = (storage.foldername(name))[1]
        and starts_with(storage.filename(name), g.id::text || '_')
        and public.is_shooting_open(g.event_id)
    )
  );

-- 5. 参加前のゲストに見せるイベント情報に、撮影時間を追加
--    （戻り値の形が変わるので、いったん削除して作り直す）
drop function if exists public.get_event_public(uuid);
create function public.get_event_public(p_event_id uuid)
returns table (
  id uuid,
  title text,
  max_photos_per_guest integer,
  reveal_at timestamptz,
  shoot_start_at timestamptz,
  shoot_end_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select e.id, e.title, e.max_photos_per_guest, e.reveal_at, e.shoot_start_at, e.shoot_end_at
  from public.events e where e.id = p_event_id;
$$;
grant execute on function public.get_event_public(uuid) to anon, authenticated;
