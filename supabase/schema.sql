-- =====================================================================
-- Event Cam: Supabase スキーマ
-- Supabase ダッシュボード > SQL Editor に丸ごと貼り付けて実行してください。
-- 事前に Authentication > Sign In / Providers で
-- 「Allow anonymous sign-ins」を ON にしておく必要があります。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. テーブル
-- ---------------------------------------------------------------------
create table if not exists public.events (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null check (char_length(title) between 1 and 100),
  max_photos_per_guest integer not null default 15 check (max_photos_per_guest between 1 and 100),
  reveal_at            timestamptz,               -- NULL = 撮影した瞬間から公開
  owner_uid            uuid not null default auth.uid(),  -- 作成した主催者（匿名ユーザー）
  created_at           timestamptz not null default now()
);

create table if not exists public.guests (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  auth_uid   uuid not null default auth.uid(),
  nickname   text not null check (char_length(nickname) between 1 and 30),
  created_at timestamptz not null default now(),
  unique (event_id, auth_uid)                     -- 1端末(1匿名ユーザー)につき1イベント1ゲスト
);

create table if not exists public.photos (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  guest_id     uuid not null references public.guests(id) on delete cascade,
  storage_path text not null unique,
  thumb_path   text unique,                -- 一覧用の小さい写真（長辺320px）
  created_at   timestamptz not null default now()
);

create index if not exists events_owner_idx         on public.events (owner_uid);
create index if not exists guests_auth_uid_idx      on public.guests (auth_uid);
create index if not exists photos_event_created_idx on public.photos (event_id, created_at desc);
create index if not exists photos_guest_idx         on public.photos (guest_id);

-- ---------------------------------------------------------------------
-- 2. ヘルパー関数（SECURITY DEFINER: ポリシー内でテーブル同士を参照しても
--    RLS が再帰しないようにする）
-- ---------------------------------------------------------------------
create or replace function public.is_event_owner(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id and e.owner_uid = (select auth.uid())
  );
$$;

create or replace function public.is_event_guest(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.guests g
    where g.event_id = p_event_id and g.auth_uid = (select auth.uid())
  );
$$;

create or replace function public.owns_guest(p_guest_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.guests g
    where g.id = p_guest_id and g.auth_uid = (select auth.uid())
  );
$$;

-- reveal_at が NULL または過去なら「現像済み」
create or replace function public.is_event_revealed(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select e.reveal_at is null or e.reveal_at <= now()
       from public.events e where e.id = p_event_id),
    false
  );
$$;

-- ---------------------------------------------------------------------
-- 3. 公開用 RPC
--    events テーブル自体は主催者と参加済みゲストにしか見せない。
--    参加前のゲストには、ID を知っている場合に限りこの関数で最小限の情報を返す。
-- ---------------------------------------------------------------------
create or replace function public.get_event_public(p_event_id uuid)
returns table (id uuid, title text, max_photos_per_guest integer, reveal_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select e.id, e.title, e.max_photos_per_guest, e.reveal_at
  from public.events e where e.id = p_event_id;
$$;

-- 参加者数・撮影枚数（現像前の「◯枚現像中」表示と管理画面で使用）
create or replace function public.get_event_stats(p_event_id uuid)
returns table (guest_count integer, photo_count integer)
language sql stable security definer set search_path = '' as $$
  select
    (select count(*)::int from public.guests g where g.event_id = p_event_id),
    (select count(*)::int from public.photos p where p.event_id = p_event_id);
$$;

-- ---------------------------------------------------------------------
-- 4. 撮影枚数の上限をDB側でも強制するトリガー
--    （フロントのチェックだけでは改ざん・連打・複数タブで突破できるため）
-- ---------------------------------------------------------------------
create or replace function public.enforce_photo_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_event_id uuid;
  v_max      integer;
  v_count    integer;
begin
  -- 同一ゲストの同時INSERTを直列化
  select g.event_id into v_event_id
    from public.guests g where g.id = new.guest_id
    for update;

  if v_event_id is null or v_event_id <> new.event_id then
    raise exception 'guest_event_mismatch';
  end if;

  select e.max_photos_per_guest into v_max from public.events e where e.id = new.event_id;
  select count(*) into v_count from public.photos p where p.guest_id = new.guest_id;

  if v_count >= v_max then
    raise exception 'photo_limit_reached';
  end if;

  return new;
end;
$$;

drop trigger if exists photos_enforce_rules on public.photos;
create trigger photos_enforce_rules
  before insert on public.photos
  for each row execute function public.enforce_photo_rules();

-- ---------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------
alter table public.events enable row level security;
alter table public.guests enable row level security;
alter table public.photos enable row level security;

-- events -------------------------------------------------------------
drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated
  using (owner_uid = (select auth.uid()) or public.is_event_guest(id));

drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to authenticated
  with check (owner_uid = (select auth.uid()));

drop policy if exists events_update on public.events;
create policy events_update on public.events for update to authenticated
  using (owner_uid = (select auth.uid()))
  with check (owner_uid = (select auth.uid()));

drop policy if exists events_delete on public.events;
create policy events_delete on public.events for delete to authenticated
  using (owner_uid = (select auth.uid()));

-- guests -------------------------------------------------------------
drop policy if exists guests_select on public.guests;
create policy guests_select on public.guests for select to authenticated
  using (
    auth_uid = (select auth.uid())
    or public.is_event_owner(event_id)
    or public.is_event_guest(event_id)       -- 同じイベントの参加者同士はニックネームが見える
  );

drop policy if exists guests_insert on public.guests;
create policy guests_insert on public.guests for insert to authenticated
  with check (auth_uid = (select auth.uid()));

drop policy if exists guests_update on public.guests;
create policy guests_update on public.guests for update to authenticated
  using (auth_uid = (select auth.uid()))
  with check (auth_uid = (select auth.uid()));

drop policy if exists guests_delete on public.guests;
create policy guests_delete on public.guests for delete to authenticated
  using (public.is_event_owner(event_id));

-- photos -------------------------------------------------------------
-- 見える写真 = 自分が撮った写真 / 主催者 / 参加者かつ現像済み
drop policy if exists photos_select on public.photos;
create policy photos_select on public.photos for select to authenticated
  using (
    public.owns_guest(guest_id)
    or public.is_event_owner(event_id)
    or (public.is_event_guest(event_id) and public.is_event_revealed(event_id))
  );

drop policy if exists photos_insert on public.photos;
create policy photos_insert on public.photos for insert to authenticated
  with check (
    public.owns_guest(guest_id)
    and starts_with(storage_path, event_id::text || '/' || guest_id::text || '_')
    and (thumb_path is null or starts_with(thumb_path, event_id::text || '/' || guest_id::text || '_'))
  );

drop policy if exists photos_delete on public.photos;
create policy photos_delete on public.photos for delete to authenticated
  using (public.owns_guest(guest_id) or public.is_event_owner(event_id));

-- ---------------------------------------------------------------------
-- 6. Storage（非公開バケット + 署名付きURLで配信）
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-photos', 'event-photos', false, 2097152, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- アップロード: {eventId}/{自分のguestId}_*.webp のみ
drop policy if exists event_photos_insert on storage.objects;
create policy event_photos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'event-photos'
    and exists (
      select 1 from public.guests g
      where g.auth_uid = (select auth.uid())
        and g.event_id::text = (storage.foldername(name))[1]
        and starts_with(storage.filename(name), g.id::text || '_')
    )
  );

-- 閲覧: photos テーブルで「見える」写真だけ（photos の RLS がそのまま効く）
drop policy if exists event_photos_select on storage.objects;
create policy event_photos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'event-photos'
    and exists (
      select 1 from public.photos p
      where p.storage_path = name or p.thumb_path = name
    )
  );

-- 削除: アップロードした本人 / 主催者
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

-- ---------------------------------------------------------------------
-- 7. Realtime（RLS はRealtime配信にも適用されるので、現像前は他人の写真は届かない）
-- ---------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.photos;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.guests;
exception when duplicate_object then null;
end $$;
