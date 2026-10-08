"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { getCurrentUserId, getSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/utils/format";
import type { EventRow } from "@/types";

/** このブラウザで作成したイベント一覧（匿名ユーザーのセッションに紐づく） */
export function MyEvents() {
  const [events, setEvents] = useState<EventRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const userId = await getCurrentUserId(supabase);
        if (!userId) return;
        const { data } = await supabase
          .from("events")
          .select("*")
          .eq("owner_uid", userId)
          .order("created_at", { ascending: false })
          .limit(20);
        if (!cancelled && data) setEvents(data);
      } catch {
        /* 環境変数未設定などはトップでは無視 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (events.length === 0) return null;

  return (
    <div className="mt-14 max-w-md">
      <h2 className="text-xs tracking-wider text-muted">あなたが作成したイベント</h2>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
        {events.map((e) => (
          <li key={e.id}>
            <Link href={`/admin/events/${e.id}`} className="flex items-center gap-3 px-4 py-3.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{e.title}</span>
                <span className="block text-xs text-muted">
                  {e.reveal_at ? `${formatDateTime(e.reveal_at)} 現像` : "すぐ公開"}
                </span>
              </span>
              <ChevronRight className="size-4 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
