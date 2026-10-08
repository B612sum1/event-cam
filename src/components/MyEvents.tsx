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
    <div className="mt-14 w-full max-w-md text-left">
      <h2 className="px-4 text-[13px] text-label-2">作ったイベント</h2>
      <ul className="group-list mt-1.5">
        {events.map((e) => (
          <li key={e.id} className="group-row p-0">
            <Link href={`/admin/events/${e.id}`} className="flex w-full items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base">{e.title}</span>
                <span className="block text-[13px] text-label-2">
                  {e.reveal_at ? `現像 ${formatDateTime(e.reveal_at)}` : "撮ってすぐ公開"}
                </span>
              </span>
              <ChevronRight className="size-4 text-label-3" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
