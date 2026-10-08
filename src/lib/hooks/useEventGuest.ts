"use client";

import { useCallback, useEffect, useState } from "react";
import { getCurrentUserId, getSupabaseBrowserClient } from "@/lib/supabase/client";
import { loadStoredGuest, saveStoredGuest } from "@/lib/utils/guestStorage";
import { isUuid, toFriendlyError } from "@/lib/utils/format";
import type { GuestRow, PublicEvent } from "@/types";

export type EventGuestState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "no-guest"; event: PublicEvent; userId: string | null; isOwner: boolean }
  | { status: "ready"; event: PublicEvent; guest: GuestRow; userId: string; isOwner: boolean };

/**
 * イベント情報と「この端末のゲスト」を解決する。
 * 1. get_event_public RPC でイベントを取得（参加前でも読める）
 * 2. 匿名セッションがあれば guests から自分の行を取得（localStorage はヒントとして使う）
 */
export function useEventGuest(eventId: string | undefined) {
  const [state, setState] = useState<EventGuestState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!isUuid(eventId)) {
        setState({ status: "not-found" });
        return;
      }
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: events, error: eventError } = await supabase.rpc("get_event_public", {
          p_event_id: eventId,
        });
        if (eventError) throw eventError;
        const event = events?.[0];
        if (!event) {
          if (!cancelled) setState({ status: "not-found" });
          return;
        }

        const userId = await getCurrentUserId(supabase);
        if (!userId) {
          if (!cancelled) setState({ status: "no-guest", event, userId: null, isOwner: false });
          return;
        }

        const stored = loadStoredGuest(eventId);
        const [{ data: guest }, { data: owned }] = await Promise.all([
          supabase
            .from("guests")
            .select("*")
            .eq("event_id", eventId)
            .eq("auth_uid", userId)
            .maybeSingle(),
          supabase.from("events").select("id").eq("id", eventId).eq("owner_uid", userId).maybeSingle(),
        ]);
        const isOwner = Boolean(owned);
        if (cancelled) return;

        if (!guest) {
          setState({ status: "no-guest", event, userId, isOwner });
          return;
        }
        if (!stored || stored.guest_id !== guest.id || stored.nickname !== guest.nickname) {
          saveStoredGuest({ guest_id: guest.id, event_id: eventId, nickname: guest.nickname });
        }
        setState({ status: "ready", event, guest, userId, isOwner });
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: toFriendlyError(error) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return { state, reload };
}
