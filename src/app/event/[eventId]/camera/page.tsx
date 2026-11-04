"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, CloudOff, Images, Loader2 } from "lucide-react";
import { CameraView } from "@/components/CameraView";
import { StatusScreen } from "@/components/StatusScreen";
import { useEventGuest } from "@/lib/hooks/useEventGuest";
import { usePendingUploads } from "@/lib/hooks/usePendingUploads";
import { useI18n } from "@/lib/i18n";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatDateTime, formatTime, getShootingState, isRevealed, toFriendlyError } from "@/lib/utils/format";
import type { CompressedImage } from "@/lib/utils/imageCompression";
import { newShotId } from "@/lib/utils/uploadQueue";

type Toast = { id: number; kind: "success" | "info" | "error"; message: string };

/** 撮影済みの枚数を端末にも覚えておく（電波が無くて数えられないときに使う） */
const usedKey = (guestId: string) => `event-cam:used:${guestId}`;
function readUsed(guestId: string): number {
  try {
    return Number(localStorage.getItem(usedKey(guestId))) || 0;
  } catch {
    return 0;
  }
}
function writeUsed(guestId: string, n: number) {
  try {
    localStorage.setItem(usedKey(guestId), String(n));
  } catch {
    /* 覚えられなくても撮影は続ける */
  }
}

export default function CameraPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const router = useRouter();
  const { state } = useEventGuest(eventId);
  const { t, lang } = useI18n();
  const c = t.camera;

  const [usedCount, setUsedCount] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const guest = state.status === "ready" ? state.guest : null;
  const event = state.status === "ready" ? state.event : null;

  // 撮った写真は、まずこのスマホに保存してから送る（電波が悪くても写真を失わない）
  const uploads = usePendingUploads(guest?.id ?? null, {
    onSent: (shot, late) => {
      setUsedCount((n) => {
        const next = (n ?? 0) + 1;
        writeUsed(shot.guestId, next);
        return next;
      });
      setToast({ id: Date.now(), kind: "success", message: late ? c.sentLater : c.saved });
    },
    onWaiting: () => setToast({ id: Date.now(), kind: "info", message: c.queued }),
    onRejected: (_shot, e) => {
      if (String((e as { message?: string })?.message ?? e).includes("photo_limit_reached") && event)
        setUsedCount(event.max_photos_per_guest);
      setToast({ id: Date.now(), kind: "error", message: c.rejected(toFriendlyError(e, lang)) });
    },
  });

  // 未参加なら参加ページへ
  useEffect(() => {
    if (state.status === "no-guest") router.replace(`/event/${eventId}/join`);
  }, [state.status, eventId, router]);

  // 自分の撮影済み枚数（RLS で自分の写真は常に見える）
  useEffect(() => {
    if (!guest) return;
    let cancelled = false;
    (async () => {
      // 電波が悪いと返事が来ないことがあるので、8秒で諦めて端末に覚えている枚数を使う
      const result = await Promise.race([
        Promise.resolve(
          getSupabaseBrowserClient().from("photos").select("id", { count: "exact", head: true }).eq("guest_id", guest.id),
        ),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]).catch(() => null);
      if (cancelled) return;
      if (result && !result.error) {
        setUsedCount(result.count ?? 0);
        writeUsed(guest.id, result.count ?? 0);
      } else {
        setUsedCount(readUsed(guest.id));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [guest]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.kind === "success" ? 1800 : 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const maxPhotos = event?.max_photos_per_guest ?? 0;
  // 未送信の写真も「撮った枚数」に数える
  const remaining = usedCount === null ? 0 : Math.max(0, maxPhotos - usedCount - uploads.pending);

  // 撮影できる時間かどうか（開始・終了の時刻をまたいだら自動で切り替わるよう定期的に確認）
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);
  const shooting = event ? getShootingState(event, nowMs) : "open";

  const { enqueue } = uploads;
  const handleCapture = useCallback(
    async ({ image, thumb }: { image: CompressedImage; thumb: CompressedImage | null }): Promise<boolean> => {
      if (!guest || !event || usedCount === null) return false;
      if (getShootingState(event) !== "open") {
        setToast({ id: Date.now(), kind: "error", message: c.notNow });
        return false;
      }
      if (remaining <= 0) {
        setToast({ id: Date.now(), kind: "error", message: t.errors.photoLimit });
        return false;
      }
      // 箱に入れた時点で「撮れた」扱い（送信は後ろで続く）
      await enqueue({
        id: newShotId(),
        eventId: event.id,
        guestId: guest.id,
        createdAt: Date.now(),
        image: image.file,
        imageExt: image.extension,
        imageMime: image.mimeType,
        thumb: thumb?.file ?? null,
        thumbExt: thumb?.extension ?? null,
        thumbMime: thumb?.mimeType ?? null,
      });
      return true;
    },
    [guest, event, usedCount, remaining, enqueue, c, t],
  );

  if (state.status === "not-found")
    return (
      <StatusScreen title={t.common.eventNotFound}>{t.common.eventNotFoundBody}</StatusScreen>
    );
  if (state.status === "error")
    return (
      <StatusScreen title={t.common.loadFailed}>
        {state.message}
      </StatusScreen>
    );
  if (!guest || !event || usedCount === null) return <StatusScreen kind="loading" />;

  const revealed = isRevealed(event.reveal_at);
  const blocked =
    shooting === "before" && event.shoot_start_at
      ? { title: c.startsAt(formatTime(event.shoot_start_at, lang)), body: c.startsBody }
      : shooting === "closed"
        ? { title: c.closedTitle, body: c.waitReveal }
        : null;

  return (
    <main className="relative flex min-h-dvh flex-1 flex-col overflow-hidden bg-bg select-none">
      <header className="safe-top relative z-10 mx-auto flex w-full max-w-md items-center justify-between gap-3 pr-4 pb-3.5 pl-5">
        <div className="min-w-0 pt-2">
          <p className="truncate text-[15px] font-semibold">{event.title}</p>
          <p className="truncate text-xs text-label-2">{c.you(guest.nickname)}</p>
        </div>
        <Link href={`/event/${event.id}/gallery`} className="btn-glass mt-2 shrink-0">
          <Images className="size-4" />
          {t.common.gallery}
        </Link>
      </header>

      <div className="relative z-10 flex flex-1 flex-col pb-[max(env(safe-area-inset-bottom),1.5rem)]">
        <CameraView
          remaining={remaining}
          blocked={blocked}
          maxPhotos={maxPhotos}
          disabled={false}
          onCapture={handleCapture}
        />
        <p className="mt-4 px-6 text-center text-xs leading-relaxed text-balance text-label-3">
          {revealed || !event.reveal_at
            ? c.footInstant(remaining)
            : c.footReveal(remaining, formatDateTime(event.reveal_at, lang))}
          {shooting === "open" && event.shoot_end_at && (
            <>
              <br />
              {c.shootUntil(formatTime(event.shoot_end_at, lang))}
            </>
          )}
        </p>

        {/* 未送信の写真 */}
        {uploads.pending > 0 && (
          <div className="mx-auto mt-3 flex w-full max-w-md items-center gap-3 px-5" role="status">
            <div className="flex min-w-0 flex-1 items-start gap-2.5 rounded-xl bg-surface px-3.5 py-2.5">
              {uploads.sending ? (
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-accent" aria-hidden />
              ) : (
                <CloudOff className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              )}
              <div className="min-w-0">
                <p className="text-[13px] font-semibold">{c.pending(uploads.pending)}</p>
                <p className="text-[11px] leading-snug text-label-2">{c.pendingHint}</p>
              </div>
            </div>
            <button type="button" onClick={uploads.flush} className="btn-glass shrink-0">
              {c.sendNow}
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div
          key={toast.id}
          role="status"
          className={`pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+5.5rem)] z-20 mx-auto flex w-fit max-w-[90%] items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-lg animate-fade-in ${
            toast.kind === "success" ? "bg-label text-black" : toast.kind === "info" ? "bg-accent text-black" : "bg-danger text-black"
          }`}
        >
          {toast.kind === "success" ? (
            <CheckCircle2 className="size-4 text-teal" aria-hidden />
          ) : toast.kind === "info" ? (
            <CloudOff className="size-4" aria-hidden />
          ) : (
            <AlertCircle className="size-4" />
          )}
          {toast.message}
        </div>
      )}
    </main>
  );
}
