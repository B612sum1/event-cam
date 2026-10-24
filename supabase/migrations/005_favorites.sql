-- =====================================================================
-- 005: お気に入り（写真にハートを付ける）
-- Supabase ダッシュボード > SQL Editor に丸ごと貼り付けて実行してください。
-- 何度実行しても問題ありません。
--
-- ・ハートを付けられるのは、その写真が「見えている」参加者だけ（現像前は付けられない）
-- ・誰がどの写真にハートを付けたかは、同じ写真が見える人にだけ見える（数の表示に使う）
-- ・付け外しできるのは自分のハートだけ
-- =====================================================================

create table if not exists public.favorites (
  photo_id   uuid not null references public.photos(id) on delete cascade,
  guest_id   uuid not null references public.guests(id) on delete cascade,
  event_id   uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (photo_id, guest_id)
);

create index if not exists favorites_event_idx on public.favorites (event_id);
create index if not exists favorites_guest_idx on public.favorites (guest_id);

alter table public.favorites enable row level security;

-- 見える：その写真が見える人（photos の RLS がそのまま効く）
drop policy if exists favorites_select on public.favorites;
create policy favorites_select on public.favorites for select to authenticated
  using (exists (select 1 from public.photos p where p.id = photo_id));

-- 付ける：自分のゲストとして、見えている写真にだけ
drop policy if exists favorites_insert on public.favorites;
create policy favorites_insert on public.favorites for insert to authenticated
  with check (
    public.owns_guest(guest_id)
    and exists (
      select 1 from public.photos p
      where p.id = photo_id and p.event_id = favorites.event_id
    )
  );

-- 外す：自分のハートだけ
drop policy if exists favorites_delete on public.favorites;
create policy favorites_delete on public.favorites for delete to authenticated
  using (public.owns_guest(guest_id));
