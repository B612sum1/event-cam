"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Camera } from "lucide-react";
import { Wordmark } from "@/components/Carton";
import { CountdownTimer } from "@/components/CountdownTimer";
import { PhotoGallery } from "@/components/PhotoGallery";
import { StatusScreen } from "@/components/StatusScreen";
import { useEventGuest } from "@/lib/hooks/useEventGuest";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatDateTime, isRevealed } from "@/lib/utils/format";
import type { EventStats } from "@/types";

export default function GalleryPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const router = useRouter();
  const { state } = useEventGuest(eventId);

  const event = state.status === "ready" || state.status === "no-guest" ? state.event : null;
  const canView = state.status === "ready" || (state.status === "no-guest" && state.isOwner);

  // 参加していない人は参加ページへ（主催者は参加していなくても見られる）
  useEffect(() => {
    if (state.status === "no-guest" && !state.isOwner) router.replace(`/event/${eventId}/join`);
  }, [state, eventId, router]);

  // 現像済みかどうか。サーバー描画とずれないよう、判定はマウント後に行う
  const [revealed, setRevealed] = useState<boolean | null>(null);
  useEffect(() => {
    if (!event) return;
    const check = () => setRevealed(isRevealed(event.reveal_at));
    check();
    // タブを開きっぱなしでも時刻を跨いだら切り替わるように
    const id = window.setInterval(check, 15_000);
    return () => window.clearInterval(id);
  }, [event]);

  const handleRevealComplete = useCallback(() => {
    // サーバー時刻との差を吸収するため、ほんの少し待ってから現像済みに切り替える
    window.setTimeout(() => setRevealed(true), 1500);
  }, []);

  if (state.status === "not-found")
    return <StatusScreen title="イベントが見つかりません">URLが正しいか確認してください。</StatusScreen>;
  if (state.status === "error") return <StatusScreen title="読み込めませんでした">{state.message}</StatusScreen>;
  if (!event || !canView || revealed === null) return <StatusScreen kind="loading" />;

  const guestId = state.status === "ready" ? state.guest.id : null;

  return (
    <main className="safe-top flex min-h-dvh flex-1 flex-col bg-bg">
      <header className="mx-auto flex h-[52px] w-full max-w-5xl items-center justify-between px-5">
        <Wordmark />
        {guestId && (
          <Link href={`/event/${event.id}/camera`} className="link h-11">
            <Camera className="size-[18px]" />
            カメラ
          </Link>
        )}
      </header>

      <div className="mx-auto w-full max-w-5xl flex-1">
        {revealed || !event.reveal_at ? (
          <PhotoGallery eventId={event.id} eventTitle={event.title} />
        ) : (
          <DevelopingView eventId={event.id} guestId={guestId} revealAt={event.reveal_at} onComplete={handleRevealComplete} />
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// 現像前：大きなカウントダウン + 写真屋さんの DPE 袋

function DevelopingView({
  eventId,
  guestId,
  revealAt,
  onComplete,
}: {
  eventId: string;
  guestId: string | null;
  revealAt: string;
  onComplete: () => void;
}) {
  const [stats, setStats] = useState<EventStats | null>(null);
  const [mine, setMine] = useState<number | null>(null);

  // 何枚現像待ちか（中身は見せず枚数だけ）
  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseBrowserClient();
    const load = async () => {
      const [{ data }, own] = await Promise.all([
        supabase.rpc("get_event_stats", { p_event_id: eventId }),
        guestId
          ? supabase.from("photos").select("id", { count: "exact", head: true }).eq("guest_id", guestId)
          : Promise.resolve(null),
      ]);
      if (cancelled) return;
      if (data?.[0]) setStats(data[0]);
      if (own && !own.error) setMine(own.count ?? 0);
    };
    void load();
    const id = window.setInterval(load, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [eventId, guestId]);

  const reveal = new Date(revealAt);
  const short = `${reveal.getMonth() + 1}/${reveal.getDate()} ${String(reveal.getHours()).padStart(2, "0")}:${String(
    reveal.getMinutes(),
  ).padStart(2, "0")}`;

  return (
    <div className="safe-bottom mx-auto flex min-h-[calc(100dvh-60px)] max-w-md flex-col px-5">
      <h1 className="large-title mt-3.5">
        ただいま、
        <br />
        現像中。
      </h1>
      <p className="mt-2.5 text-[15px] leading-relaxed text-label-2">
        {formatDateTime(revealAt)} に、みんなの写真が届きます。
      </p>

      <div className="mt-8">
        <CountdownTimer target={revealAt} onComplete={onComplete} />
      </div>

      {/* DPE袋 */}
      <div className="flex flex-1 items-center justify-center py-10">
        <div className="kraft relative h-[250px] w-[300px] -rotate-3 overflow-hidden rounded-md px-5 pt-11 text-[13px] text-teal-ink shadow-[0_30px_50px_-20px_rgb(0_0_0/0.9)]">
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-7 bg-kraft-deep/70"
            style={{ clipPath: "polygon(0 0, 100% 0, 94% 100%, 6% 100%)" }}
          />
          <p className="border-b-2 border-teal-ink pb-1.5 text-lg font-bold">現像・プリント</p>
          {[
            ["お預かり", stats ? `${stats.photo_count} 枚` : "…"],
            ["参加", stats ? `${stats.guest_count} 人` : "…"],
            ["お渡し", short],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-3 border-b border-teal-ink/35 py-2.5">
              <span className="w-14 shrink-0">{k}</span>
              <span className="font-bold text-ink">{v}</span>
            </div>
          ))}
          <span
            aria-hidden
            className="absolute top-[58px] right-[18px] flex size-[70px] rotate-[14deg] flex-col items-center justify-center rounded-full border-[3px] border-tomato/80 text-tomato/90 mix-blend-multiply"
          >
            <span className="text-[15px] leading-none font-bold">現像中</span>
            <span className="cond mt-1 text-[10px]">EVENT CAM</span>
          </span>
        </div>
      </div>

      {guestId && (
        <div className="group-list">
          <div className="group-row h-[50px]">
            <span>あなたが撮った写真</span>
            <span className="text-label-2">{mine ?? "…"} 枚</span>
          </div>
        </div>
      )}
    </div>
  );
}
