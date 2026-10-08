"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Camera, Sparkles } from "lucide-react";
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
    return <StatusScreen title="イベントが見つかりません">URLが正しいかご確認ください。</StatusScreen>;
  if (state.status === "error") return <StatusScreen title="読み込みに失敗しました">{state.message}</StatusScreen>;
  if (!event || !canView || revealed === null) return <StatusScreen kind="loading" />;

  const isGuest = state.status === "ready";

  return (
    <main className="paper-grain flex min-h-dvh flex-1 flex-col">
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-paper/85 px-4 pb-3 backdrop-blur-md sm:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] tracking-[0.3em] text-gold">GALLERY</p>
            <h1 className="truncate font-serif text-lg tracking-wide">{event.title}</h1>
          </div>
          {isGuest && (
            <Link
              href={`/event/${event.id}/camera`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-body px-4 py-2.5 text-xs font-medium text-white"
            >
              <Camera className="size-4" />
              カメラ
            </Link>
          )}
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl flex-1 px-2 py-5 sm:px-8">
        {revealed || !event.reveal_at ? (
          <PhotoGallery eventId={event.id} eventTitle={event.title} />
        ) : (
          <DevelopingView eventId={event.id} revealAt={event.reveal_at} onComplete={handleRevealComplete} />
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------

function DevelopingView({
  eventId,
  revealAt,
  onComplete,
}: {
  eventId: string;
  revealAt: string;
  onComplete: () => void;
}) {
  const [stats, setStats] = useState<EventStats | null>(null);

  // 何枚現像待ちか（中身は見せず枚数だけ）
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await getSupabaseBrowserClient().rpc("get_event_stats", { p_event_id: eventId });
      if (!cancelled && data?.[0]) setStats(data[0]);
    };
    void load();
    const id = window.setInterval(load, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [eventId]);

  const count = stats?.photo_count ?? 0;
  const tiles = Math.min(Math.max(count, 9), 24);

  return (
    <div className="relative">
      {/* ぼかしプレビュー：現像液の中のフィルムのような抽象パターン */}
      <ul className="grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-2 lg:grid-cols-6" aria-hidden>
        {Array.from({ length: tiles }).map((_, i) => (
          <li
            key={i}
            className={`overflow-hidden rounded-[3px] ${i < count ? "" : "opacity-40"}`}
            style={{ aspectRatio: "3 / 4" }}
          >
            <div
              className="h-full w-full animate-develop blur-xl"
              style={{
                animationDelay: `${(i % 7) * 0.35}s`,
                background: `radial-gradient(circle at ${20 + ((i * 37) % 60)}% ${25 + ((i * 53) % 50)}%, hsl(${
                  20 + ((i * 47) % 40)
                } 45% 62%), transparent 60%), radial-gradient(circle at ${70 - ((i * 29) % 40)}% ${
                  70 - ((i * 17) % 40)
                }%, hsl(${330 + ((i * 23) % 40)} 30% 45%), transparent 55%), #3a2f2a`,
              }}
            />
          </li>
        ))}
      </ul>

      <div className="absolute inset-0 flex items-start justify-center bg-gradient-to-b from-paper/30 via-paper/60 to-paper px-4 pt-14 sm:items-center sm:pt-0">
        <div className="w-full max-w-md rounded-3xl border border-line bg-card/90 px-6 py-9 text-center shadow-[0_30px_80px_-40px_rgb(0_0_0/0.45)] backdrop-blur">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-accent/10 text-accent">
            <Sparkles className="size-5" />
          </span>
          <p className="mt-4 text-xs tracking-[0.3em] text-gold">NOW DEVELOPING</p>
          <h2 className="mt-2 font-serif text-2xl tracking-wide">ただいま現像中</h2>
          <p className="mt-3 text-sm text-muted">{formatDateTime(revealAt)} に一斉公開</p>
          <div className="mt-8">
            <CountdownTimer target={revealAt} onComplete={onComplete} />
          </div>
          <p className="mt-8 text-sm text-muted">
            {stats ? (
              <>
                <strong className="font-serif text-xl text-ink">{stats.photo_count}</strong> 枚の写真が
                <strong className="font-serif text-xl text-ink"> {stats.guest_count}</strong> 人から届いています
              </>
            ) : (
              " "
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
