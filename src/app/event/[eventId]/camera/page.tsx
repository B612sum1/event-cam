"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Images, AlertCircle } from "lucide-react";
import { CameraView } from "@/components/CameraView";
import { StatusScreen } from "@/components/StatusScreen";
import { useEventGuest } from "@/lib/hooks/useEventGuest";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatDateTime, isRevealed, toFriendlyError } from "@/lib/utils/format";
import type { CompressedImage } from "@/lib/utils/imageCompression";
import { PHOTO_BUCKET } from "@/types";

type Toast = { id: number; kind: "success" | "error"; message: string };

export default function CameraPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const router = useRouter();
  const { state } = useEventGuest(eventId);

  const [usedCount, setUsedCount] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const guest = state.status === "ready" ? state.guest : null;
  const event = state.status === "ready" ? state.event : null;

  // 未参加なら参加ページへ
  useEffect(() => {
    if (state.status === "no-guest") router.replace(`/event/${eventId}/join`);
  }, [state.status, eventId, router]);

  // 自分の撮影済み枚数（RLS で自分の写真は常に見える）
  useEffect(() => {
    if (!guest) return;
    let cancelled = false;
    (async () => {
      const { count, error } = await getSupabaseBrowserClient()
        .from("photos")
        .select("id", { count: "exact", head: true })
        .eq("guest_id", guest.id);
      if (!cancelled) setUsedCount(error ? 0 : (count ?? 0));
    })();
    return () => {
      cancelled = true;
    };
  }, [guest]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.kind === "error" ? 4000 : 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const maxPhotos = event?.max_photos_per_guest ?? 0;
  const remaining = usedCount === null ? 0 : Math.max(0, maxPhotos - usedCount);

  const handleCapture = useCallback(
    async ({ image, thumb }: { image: CompressedImage; thumb: CompressedImage | null }): Promise<boolean> => {
      if (!guest || !event || usedCount === null) return false;
      if (usedCount >= event.max_photos_per_guest) {
        setToast({ id: Date.now(), kind: "error", message: "撮影できる枚数の上限に達しました。" });
        return false;
      }

      setUploading(true);
      const supabase = getSupabaseBrowserClient();
      const bucket = supabase.storage.from(PHOTO_BUCKET);
      const base = `${event.id}/${guest.id}_${Date.now()}`;
      const path = `${base}.${image.extension}`;
      const uploaded: string[] = [];

      try {
        const { error: uploadError } = await bucket.upload(path, image.file, {
          contentType: image.mimeType,
          cacheControl: "31536000",
          upsert: false,
        });
        if (uploadError) throw uploadError;
        uploaded.push(path);

        // 一覧用の小さい写真。失敗しても元の写真で表示できるので、撮影は止めない
        let thumbPath: string | null = null;
        if (thumb) {
          const candidate = `${base}_thumb.${thumb.extension}`;
          const { error: thumbError } = await bucket.upload(candidate, thumb.file, {
            contentType: thumb.mimeType,
            cacheControl: "31536000",
            upsert: false,
          });
          if (!thumbError) {
            thumbPath = candidate;
            uploaded.push(candidate);
          }
        }

        let { error: insertError } = await supabase
          .from("photos")
          .insert({ event_id: event.id, guest_id: guest.id, storage_path: path, thumb_path: thumbPath });

        // DB にまだ thumb_path 列が無い（002_thumbnails.sql 未実行）場合は、サムネイル無しで保存する
        if (insertError && thumbPath && /thumb_path/.test(insertError.message)) {
          ({ error: insertError } = await supabase
            .from("photos")
            .insert({ event_id: event.id, guest_id: guest.id, storage_path: path }));
          if (!insertError) await bucket.remove([thumbPath]);
        }

        if (insertError) {
          if (insertError.message.includes("photo_limit_reached")) {
            setUsedCount(event.max_photos_per_guest);
          }
          throw insertError;
        }

        setUsedCount((c) => (c ?? 0) + 1);
        setToast({ id: Date.now(), kind: "success", message: "撮影しました" });
        return true;
      } catch (e) {
        // DB 側で弾かれた（上限超過など）ら、アップロード済みのファイルを片付ける
        if (uploaded.length) await bucket.remove(uploaded);
        setToast({ id: Date.now(), kind: "error", message: toFriendlyError(e) });
        return false;
      } finally {
        setUploading(false);
      }
    },
    [guest, event, usedCount],
  );

  if (state.status === "not-found")
    return (
      <StatusScreen title="イベントが見つかりません">
        QRコードやURLが正しいか、主催者にご確認ください。
      </StatusScreen>
    );
  if (state.status === "error")
    return (
      <StatusScreen title="読み込みに失敗しました">
        {state.message}
      </StatusScreen>
    );
  if (!guest || !event || usedCount === null) return <StatusScreen kind="loading" />;

  const revealed = isRevealed(event.reveal_at);

  return (
    <main className="relative flex min-h-dvh flex-1 flex-col overflow-hidden bg-bg select-none">
      <header className="safe-top relative z-10 mx-auto flex w-full max-w-md items-center justify-between gap-3 pr-4 pb-3.5 pl-5">
        <div className="min-w-0 pt-2">
          <p className="truncate text-[15px] font-semibold">{event.title}</p>
          <p className="truncate text-xs text-label-2">{guest.nickname} さん</p>
        </div>
        <Link href={`/event/${event.id}/gallery`} className="btn-glass mt-2 shrink-0">
          <Images className="size-4" />
          ギャラリー
        </Link>
      </header>

      <div className="relative z-10 flex flex-1 flex-col pb-[max(env(safe-area-inset-bottom),1.5rem)]">
        <CameraView
          remaining={remaining}
          maxPhotos={maxPhotos}
          disabled={uploading}
          onCapture={handleCapture}
        />
        <p className="mt-4 px-6 text-center text-xs leading-relaxed text-balance text-label-3">
          {revealed || !event.reveal_at
            ? `残り ${remaining} 枚。撮った写真は、すぐギャラリーに並びます。`
            : `残り ${remaining} 枚。現像は ${formatDateTime(event.reveal_at)}。`}
        </p>
      </div>

      {toast && (
        <div
          key={toast.id}
          role="status"
          className={`pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+5.5rem)] z-20 mx-auto flex w-fit max-w-[90%] items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-lg animate-fade-in ${
            toast.kind === "success" ? "bg-label text-black" : "bg-danger text-black"
          }`}
        >
          {toast.kind === "success" ? (
            <CheckCircle2 className="size-4 text-teal" aria-hidden />
          ) : (
            <AlertCircle className="size-4" />
          )}
          {toast.message}
        </div>
      )}
    </main>
  );
}
