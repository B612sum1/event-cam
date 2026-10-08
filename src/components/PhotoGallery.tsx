"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, RefreshCw, X } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatTime, toFriendlyError } from "@/lib/utils/format";
import { PHOTO_BUCKET, type GalleryPhoto, type PhotoRow } from "@/types";

/** 署名付きURLの有効期限（秒）。披露宴〜二次会くらいは開きっぱなしでも切れない長さ */
const SIGNED_URL_TTL = 60 * 60 * 6;
const PAGE_LIMIT = 1000;

type Props = {
  eventId: string;
  eventTitle: string;
};

/**
 * 現像済みギャラリー：写真グリッド + Supabase Realtime で新着を追加 + 拡大モーダル
 * （RLS により、現像前は他人の写真はそもそも取得・配信されない）
 */
export function PhotoGallery({ eventId, eventTitle }: Props) {
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const nicknameCache = useRef(new Map<string, string>());

  const signUrls = useCallback(async (paths: string[]) => {
    const supabase = getSupabaseBrowserClient();
    const result = new Map<string, string>();
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { data, error } = await supabase.storage
        .from(PHOTO_BUCKET)
        .createSignedUrls(chunk, SIGNED_URL_TTL);
      if (error) throw error;
      data?.forEach((d) => {
        if (d.signedUrl && d.path) result.set(d.path, d.signedUrl);
      });
    }
    return result;
  }, []);

  // ---- 初回読み込み ------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase
          .from("photos")
          .select("id, event_id, guest_id, storage_path, created_at, guests(nickname)")
          .eq("event_id", eventId)
          .order("created_at", { ascending: false })
          .limit(PAGE_LIMIT);
        if (error) throw error;

        const rows = data ?? [];
        const urls = rows.length ? await signUrls(rows.map((r) => r.storage_path)) : new Map();
        const list: GalleryPhoto[] = rows.flatMap((r) => {
          const url = urls.get(r.storage_path);
          const nickname = r.guests?.nickname ?? "ゲスト";
          nicknameCache.current.set(r.guest_id, nickname);
          if (!url) return [];
          const { guests: _guests, ...photo } = r;
          void _guests;
          return [{ ...photo, url, nickname }];
        });
        if (!cancelled) {
          setPhotos(list);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(toFriendlyError(e));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, signUrls, reloadKey]);

  // 端末の時計がサーバーより進んでいると、現像直後の取得で他人の写真がまだ見えないことがあるため
  // 少し後にもう一度だけ読み直す（以降の新着は Realtime で届く）
  useEffect(() => {
    const t = window.setTimeout(() => setReloadKey((k) => k + 1), 8000);
    return () => window.clearTimeout(t);
  }, [eventId]);

  const refresh = () => {
    setRefreshing(true);
    setReloadKey((k) => k + 1);
  };

  // ---- Realtime：新しく撮られた写真を即追加 ---------------------------------
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    const resolveNickname = async (guestId: string) => {
      const cached = nicknameCache.current.get(guestId);
      if (cached) return cached;
      const { data } = await supabase.from("guests").select("nickname").eq("id", guestId).maybeSingle();
      const name = data?.nickname ?? "ゲスト";
      nicknameCache.current.set(guestId, name);
      return name;
    };

    const channel = supabase
      .channel(`gallery:${eventId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "photos", filter: `event_id=eq.${eventId}` },
        async (payload) => {
          const row = payload.new as PhotoRow;
          try {
            const [nickname, urls] = await Promise.all([
              resolveNickname(row.guest_id),
              signUrls([row.storage_path]),
            ]);
            const url = urls.get(row.storage_path);
            if (!url) return;
            setPhotos((prev) =>
              prev.some((p) => p.id === row.id) ? prev : [{ ...row, url, nickname }, ...prev],
            );
            // モーダルで見ている写真がずれないように
            setSelected((s) => (s === null ? s : s + 1));
          } catch {
            /* 1枚取れなくても全体は止めない */
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "photos" },
        (payload) => {
          const id = (payload.old as Partial<PhotoRow>).id;
          if (!id) return;
          setPhotos((prev) => prev.filter((p) => p.id !== id));
          setSelected(null);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [eventId, signUrls]);

  if (loading) {
    return (
      <div className="flex justify-center py-20 text-muted">
        <Loader2 className="size-6 animate-spin" aria-label="読み込み中" />
      </div>
    );
  }

  if (error) {
    return <p className="py-16 text-center text-sm text-danger">{error}</p>;
  }

  const refreshButton = (
    <button
      type="button"
      onClick={refresh}
      disabled={refreshing}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted ring-1 ring-line disabled:opacity-50"
    >
      <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
      更新
    </button>
  );

  if (photos.length === 0) {
    return (
      <div className="flex flex-col items-center py-20 text-center">
        <p className="font-serif text-lg">まだ写真がありません</p>
        <p className="mt-2 mb-5 text-sm text-muted">撮影された写真は、ここにすぐ並びます。</p>
        {refreshButton}
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between px-1">
        <p className="text-xs tracking-wider text-muted">{photos.length}枚の写真</p>
        {refreshButton}
      </div>
      <ul className="grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-2 lg:grid-cols-5">
        {photos.map((p, i) => (
          <li key={p.id} className="animate-fade-in">
            <button
              type="button"
              onClick={() => setSelected(i)}
              className="group relative block w-full overflow-hidden rounded-[3px] bg-paper-2 focus-visible:outline-2 focus-visible:outline-accent"
              style={{ aspectRatio: "3 / 4" }}
              aria-label={`${p.nickname}さんの写真を拡大`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
              />
            </button>
          </li>
        ))}
      </ul>

      {selected !== null && photos[selected] && (
        <PhotoModal
          photos={photos}
          index={selected}
          eventTitle={eventTitle}
          onChange={setSelected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

type ModalProps = {
  photos: GalleryPhoto[];
  index: number;
  eventTitle: string;
  onChange: (index: number) => void;
  onClose: () => void;
};

function PhotoModal({ photos, index, eventTitle, onChange, onClose }: ModalProps) {
  const photo = photos[index];
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const touchStartX = useRef<number | null>(null);

  const prev = useCallback(() => index > 0 && onChange(index - 1), [index, onChange]);
  const next = useCallback(
    () => index < photos.length - 1 && onChange(index + 1),
    [index, photos.length, onChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, prev, next]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(photo.url);
      if (!res.ok) throw new Error("画像を取得できませんでした");
      const blob = await res.blob();
      const ext = blob.type === "image/jpeg" ? "jpg" : "webp";
      const stamp = photo.created_at.slice(0, 19).replace(/[-:T]/g, "");
      const filename = `${eventTitle}_${photo.nickname}_${stamp}.${ext}`.replace(/[\\/:*?"<>|\s]+/g, "_");
      const file = new File([blob], filename, { type: blob.type });

      // スマホは共有シート（iPhone なら「画像を保存」で写真アプリへ）、PC は通常ダウンロード
      const isTouch = window.matchMedia("(pointer: coarse)").matches;
      if (isTouch && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const href = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = href;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // 共有シートを閉じただけ
      setSaveError(toFriendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black text-white animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="写真の拡大表示"
      onTouchStart={(e) => (touchStartX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchStartX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        if (dx > 60) prev();
        if (dx < -60) next();
        touchStartX.current = null;
      }}
    >
      <header className="safe-top flex items-center justify-between gap-3 px-4 pb-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{photo.nickname}</p>
          <p className="text-xs text-white/50">
            {formatTime(photo.created_at)}・{index + 1} / {photos.length}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="grid size-10 place-items-center rounded-full bg-white/10"
        >
          <X className="size-5" />
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2" onClick={onClose}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={photo.id}
          src={photo.url}
          alt={`${photo.nickname}さんが撮影した写真`}
          className="max-h-full max-w-full rounded-[2px] object-contain animate-fade-in"
          onClick={(e) => e.stopPropagation()}
        />
        {index > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            aria-label="前の写真"
            className="absolute left-3 hidden size-11 place-items-center rounded-full bg-white/10 sm:grid"
          >
            <ChevronLeft className="size-6" />
          </button>
        )}
        {index < photos.length - 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            aria-label="次の写真"
            className="absolute right-3 hidden size-11 place-items-center rounded-full bg-white/10 sm:grid"
          >
            <ChevronRight className="size-6" />
          </button>
        )}
      </div>

      <footer className="safe-bottom flex flex-col items-center gap-2 px-4 pt-4">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black disabled:opacity-60"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          写真を保存
        </button>
        {saveError && <p className="text-xs text-red-300">{saveError}</p>}
      </footer>
    </div>
  );
}
