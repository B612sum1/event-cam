-- =====================================================================
-- 004: 参加時に「同じ名前の人がいるか」を確認する
-- Supabase ダッシュボード > SQL Editor に丸ごと貼り付けて実行してください。
-- 何度実行しても問題ありません。
--
-- 参加前の人は他のゲストの名前を見られないため、
-- 名前そのものは返さず「使われているかどうか」だけを返す。
-- 空白（全角含む）と大文字・小文字の違いは無視して比べる。
-- 自分自身（同じ端末で参加し直す場合）は除く。
-- =====================================================================

create or replace function public.is_nickname_taken(p_event_id uuid, p_nickname text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.guests g
    where g.event_id = p_event_id
      and g.auth_uid is distinct from (select auth.uid())
      and lower(regexp_replace(g.nickname, '[[:space:]　]+', '', 'g'))
        = lower(regexp_replace(p_nickname, '[[:space:]　]+', '', 'g'))
  );
$$;

grant execute on function public.is_nickname_taken(uuid, text) to anon, authenticated;
