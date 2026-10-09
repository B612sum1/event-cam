"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Share } from "lucide-react";
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
          .select("*, guests(nickname)")
          .eq("event_id", eventId)
          .order("created_at", { ascending: false })
          .limit(PAGE_LIMIT);
        if (error) throw error;

        const rows = data ?? [];
        // 署名付きURLの発行だけなので転送量はかからない。実際に読み込むのは一覧ではサムネイルだけ
        const urls = rows.length
          ? await signUrls(rows.flatMap((r) => (r.thumb_path ? [r.storage_path, r.thumb_path] : [r.storage_path])))
          : new Map<string, string>();
        const list: GalleryPhoto[] = rows.flatMap((r) => {
          const url = urls.get(r.storage_path);
          const nickname = r.guests?.nickname ?? "ゲスト";
          nicknameCache.current.set(r.guest_id, nickname);
          if (!url) return [];
          const { guests: _guests, ...photo } = r;
          void _guests;
          const thumbUrl = (r.thumb_path && urls.get(r.thumb_path)) || url;
          return [{ ...photo, url, thumbUrl, nickname }];
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
              signUrls(row.thumb_path ? [row.storage_path, row.thumb_path] : [row.storage_path]),
            ]);
            const url = urls.get(row.storage_path);
            if (!url) return;
            const thumbUrl = (row.thumb_path && urls.get(row.thumb_path)) || url;
            setPhotos((prev) =>
              prev.some((p) => p.id === row.id) ? prev : [{ ...row, url, thumbUrl, nickname }, ...prev],
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
      <div className="flex justify-center py-20 text-label-3">
        <Loader2 className="size-6 animate-spin" aria-label="読み込み中" />
      </div>
    );
  }

  if (error) {
    return <p className="px-5 py-16 text-center text-sm text-danger">{error}</p>;
  }

  const refreshButton = (
    <button type="button" onClick={refresh} disabled={refreshing} className="btn-glass" aria-label="最新の写真を読み込む">
      <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
      更新
    </button>
  );

  if (photos.length === 0) {
    return (
      <div className="flex flex-col items-center px-5 py-20 text-center">
        <p className="text-[22px] font-bold tracking-[-0.01em]">まだ1枚もありません。</p>
        <p className="mt-2 mb-6 text-[15px] text-label-2">撮った写真は、ここにすぐ並びます。</p>
        {refreshButton}
      </div>
    );
  }

  return (
    <>
      <div className="px-5 pt-2.5 pb-[18px]">
        <h1 className="large-title">現像できました。</h1>
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <p className="text-[15px] text-label-2">
            {new Set(photos.map((p) => p.guest_id)).size}人が撮った、{photos.length}コマ。
          </p>
          {refreshButton}
        </div>
      </div>

      {/* ベタ焼き（コンタクトシート）：横に並んだコマがフィルムのストリップになる */}
      <ul className="safe-bottom grid grid-cols-3 gap-y-2 sm:grid-cols-4 lg:grid-cols-5">
        {photos.map((p, i) => {
          const frame = photos.length - i; // 撮影順のコマ番号
          return (
            <li key={p.id} className="animate-fade-in bg-film px-[5px] sm:px-2">
              <Sprockets />
              <p className="cond flex justify-between px-0.5 pb-1 text-[11px] leading-none text-edge/90">
                <span>▸{frame}</span>
                <span>{frame}A</span>
              </p>
              <button
                type="button"
                onClick={() => setSelected(i)}
                className="group relative block w-full overflow-hidden rounded-[2px] bg-black"
                style={{ aspectRatio: "3 / 4" }}
                aria-label={`${frame}コマ目、${p.nickname}さんの写真を開く`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumbUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
              </button>
              <p className="truncate px-0.5 pt-1 text-[10px] leading-tight text-edge/80">{p.nickname}</p>
              <Sprockets />
            </li>
          );
        })}
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
      className="fixed inset-0 z-50 flex flex-col bg-bg animate-fade-in"
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
      <header className="safe-top grid grid-cols-[1fr_auto_1fr] items-center px-3 pb-2">
        <button type="button" onClick={onClose} className="link h-11 justify-self-start px-1">
          <ChevronLeft className="size-5" />
          ベタ焼き
        </button>
        <div className="flex flex-col items-center">
          <p className="max-w-[50vw] truncate text-[15px] font-semibold">{photo.nickname}</p>
          <p className="text-[11px] text-label-2">
            {photos.length - index}コマ目　{formatTime(photo.created_at)}
          </p>
        </div>
        <span />
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2" onClick={onClose}>
        {/* プリントした写真のような白フチ */}
        <figure
          key={photo.id}
          className="relative animate-fade-in rounded-[2px] bg-sticker p-3 pb-[42px]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.url}
            alt={`${photo.nickname}さんが撮影した写真`}
            className="block max-h-[calc(100dvh-15rem)] w-auto max-w-[calc(100vw-3rem)] object-contain"
          />
          <figcaption className="absolute inset-x-3 bottom-2.5 flex items-baseline justify-between text-ink sm:bottom-3.5">
            <span className="truncate text-xs font-semibold">{eventTitle}</span>
            <span className="cond text-sm text-muted">No.{photos.length - index}</span>
          </figcaption>
        </figure>
      </div>

      <footer className="safe-bottom flex flex-col items-center px-5 pt-3">
        <div className="flex w-full max-w-sm items-center justify-around">
          <button type="button" onClick={prev} disabled={index === 0} aria-label="前の写真" className="grid size-11 place-items-center disabled:opacity-30">
            <ChevronLeft className="size-6" />
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            aria-label="写真を保存・共有"
            className="grid size-11 place-items-center text-accent disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-6 animate-spin" /> : <Share className="size-6" />}
          </button>
          <button
            type="button"
            onClick={next}
            disabled={index === photos.length - 1}
            aria-label="次の写真"
            className="grid size-11 place-items-center disabled:opacity-30"
          >
            <ChevronRight className="size-6" />
          </button>
        </div>
        {saveError && <p className="mt-1 text-xs text-danger">{saveError}</p>}
      </footer>
    </div>
  );
}

/** フィルムの送り穴 */
function Sprockets() {
  return (
    <div
      aria-hidden
      className="my-1 h-2.5 bg-[repeating-linear-gradient(90deg,transparent_0_5px,rgb(233_220_194/0.8)_5px_13px,transparent_13px_18px)] [mask:linear-gradient(#000_0_0)]"
      style={{ borderRadius: 2 }}
    />
  );
}
