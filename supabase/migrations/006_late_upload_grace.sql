-- =====================================================================
-- 006: 撮影終了の直前に撮った写真が、電波待ちで遅れて届いても保存できるようにする
-- Supabase ダッシュボード > SQL Editor に丸ごと貼り付けて実行してください。
-- 何度実行しても問題ありません。
--
-- 撮影の締め切り後も 15分間 だけ、写真の保存を受け付けます（これまでは 2分）。
-- 画面上はこれまでどおり締め切りの時刻でシャッターが押せなくなります。
-- 枚数の上限は、これまでどおりデータベースで必ず守られます。
-- =====================================================================

create or replace function public.is_shooting_open(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select (e.shoot_start_at is null or e.shoot_start_at <= now())
        and (e.shoot_end_at is null or now() < e.shoot_end_at + interval '15 minutes')
       from public.events e where e.id = p_event_id),
    false
  );
$$;

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
  if v_end is not null and now() >= v_end + interval '15 minutes' then
    raise exception 'shooting_closed';
  end if;

  select count(*) into v_count from public.photos p where p.guest_id = new.guest_id;
  if v_count >= v_max then
    raise exception 'photo_limit_reached';
  end if;

  return new;
end;
$$;
