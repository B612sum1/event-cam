"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  Heart,
  Loader2,
  RefreshCw,
  Share,
} from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { CONTACT_SHEET_MAX, renderContactSheet } from "@/lib/utils/contactSheet";
import { formatTime, toFriendlyError } from "@/lib/utils/format";
import { fetchAsFile, safeFileName, saveFiles } from "@/lib/utils/saveFiles";
import { PHOTO_BUCKET, type FavoriteRow, type GalleryPhoto, type PhotoRow } from "@/types";

/** 署名付きURLの有効期限（秒）。披露宴〜二次会くらいは開きっぱなしでも切れない長さ */
const SIGNED_URL_TTL = 60 * 60 * 6;
const PAGE_LIMIT = 1000;

type Props = {
  eventId: string;
  eventTitle: string;
  /** この端末のゲスト。主催者がゲストとして参加していない場合は null（お気に入りは付けられない） */
  guestId: string | null;
};

type Filter = "all" | "fav" | "mine";
type Busy = { label: string; done: number; total: number };
type Fav = Pick<FavoriteRow, "photo_id" | "guest_id">;

/**
 * 現像済みギャラリー：ベタ焼きの一覧 + Realtime で新着を追加 + 拡大表示
 * お気に入り・絞り込み・選んだ写真のまとめて保存・ベタ焼き画像の作成ができる。
 * （RLS により、現像前は他人の写真はそもそも取得・配信されない）
 */
export function PhotoGallery({ eventId, eventTitle, guestId }: Props) {
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const nicknameCache = useRef(new Map<string, string>());

  // お気に入り（005_favorites.sql 未実行のときは機能ごと隠す）
  const [favs, setFavs] = useState<Fav[]>([]);
  const [favReady, setFavReady] = useState(false);

  // 絞り込み・選択
  const [filter, setFilter] = useState<Filter>("all");
  const [who, setWho] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Busy | null>(null);
  const [notice, setNotice] = useState<{ id: number; text: string; error?: boolean } | null>(null);

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

  // ---- 読み込み -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const [{ data, error }, favRes] = await Promise.all([
          supabase
            .from("photos")
            .select("*, guests(nickname)")
            .eq("event_id", eventId)
            .order("created_at", { ascending: false })
            .limit(PAGE_LIMIT),
          supabase.from("favorites").select("photo_id, guest_id").eq("event_id", eventId),
        ]);
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
          setFavReady(!favRes.error);
          if (!favRes.error) setFavs(favRes.data ?? []);
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

    const resolveNickname = async (id: string) => {
      const cached = nicknameCache.current.get(id);
      if (cached) return cached;
      const { data } = await supabase.from("guests").select("nickname").eq("id", id).maybeSingle();
      const name = data?.nickname ?? "ゲスト";
      nicknameCache.current.set(id, name);
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
          } catch {
            /* 1枚取れなくても全体は止めない */
          }
        },
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "photos" }, (payload) => {
        const id = (payload.old as Partial<PhotoRow>).id;
        if (!id) return;
        setPhotos((prev) => prev.filter((p) => p.id !== id));
        setFavs((prev) => prev.filter((f) => f.photo_id !== id));
        setOpenId((cur) => (cur === id ? null : cur));
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [eventId, signUrls]);

  // 保存や作成のお知らせは少しで消す
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), notice.error ? 5000 : 2500);
    return () => window.clearTimeout(t);
  }, [notice]);

  // ---- 派生データ -------------------------------------------------------------
  /** 撮影順のコマ番号（絞り込んでも変わらない） */
  const frameOf = useMemo(() => new Map(photos.map((p, i) => [p.id, photos.length - i])), [photos]);
  const favCount = useMemo(() => {
    const m = new Map<string, number>();
    favs.forEach((f) => m.set(f.photo_id, (m.get(f.photo_id) ?? 0) + 1));
    return m;
  }, [favs]);
  const myFavs = useMemo(
    () => new Set(favs.filter((f) => f.guest_id === guestId).map((f) => f.photo_id)),
    [favs, guestId],
  );
  const photographers = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>();
    photos.forEach((p) => {
      const cur = m.get(p.guest_id);
      m.set(p.guest_id, { name: p.nickname, count: (cur?.count ?? 0) + 1 });
    });
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [photos]);

  const visible = useMemo(
    () =>
      photos.filter(
        (p) =>
          (filter === "all" || (filter === "fav" ? myFavs.has(p.id) : p.guest_id === guestId)) &&
          (!who || p.guest_id === who),
      ),
    [photos, filter, myFavs, guestId, who],
  );
  const openIndex = openId ? visible.findIndex((p) => p.id === openId) : -1;

  // ---- 操作 -------------------------------------------------------------------
  const toggleFavorite = async (photo: GalleryPhoto) => {
    if (!guestId || !favReady) return;
    const on = myFavs.has(photo.id);
    // 先に画面を変えて、失敗したら戻す
    setFavs((prev) =>
      on ? prev.filter((f) => !(f.photo_id === photo.id && f.guest_id === guestId)) : [...prev, { photo_id: photo.id, guest_id: guestId }],
    );
    const supabase = getSupabaseBrowserClient();
    const { error } = on
      ? await supabase.from("favorites").delete().eq("photo_id", photo.id).eq("guest_id", guestId)
      : await supabase.from("favorites").insert({ photo_id: photo.id, guest_id: guestId, event_id: eventId });
    if (error) {
      setFavs((prev) =>
        on ? [...prev, { photo_id: photo.id, guest_id: guestId }] : prev.filter((f) => !(f.photo_id === photo.id && f.guest_id === guestId)),
      );
      setNotice({ id: Date.now(), text: toFriendlyError(error), error: true });
    }
  };

  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allPicked = visible.length > 0 && visible.every((p) => picked.has(p.id));
  const pickAll = () => setPicked(allPicked ? new Set() : new Set(visible.map((p) => p.id)));
  const endSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };

  /** 選んだ写真を、撮影順に並べて返す */
  const pickedPhotos = () =>
    photos.filter((p) => picked.has(p.id)).sort((a, b) => (frameOf.get(a.id) ?? 0) - (frameOf.get(b.id) ?? 0));

  const savePicked = async () => {
    const list = pickedPhotos();
    if (!list.length) return;
    setBusy({ label: "写真を準備しています", done: 0, total: list.length });
    try {
      const files: File[] = [];
      for (const p of list) {
        files.push(await fetchAsFile(p.url, `${frameOf.get(p.id)}_${p.nickname}`));
        setBusy({ label: "写真を準備しています", done: files.length, total: list.length });
      }
      setBusy(null);
      const result = await saveFiles(files, `${eventTitle}_写真${files.length}枚`);
      if (result !== "cancelled") {
        setNotice({ id: Date.now(), text: result === "shared" ? `${files.length}枚を保存しました` : "ダウンロードしました" });
        endSelecting();
      }
    } catch (e) {
      setNotice({ id: Date.now(), text: toFriendlyError(e), error: true });
    } finally {
      setBusy(null);
    }
  };

  const makeContactSheet = async () => {
    const list = pickedPhotos();
    if (!list.length) return;
    if (list.length > CONTACT_SHEET_MAX) {
      setNotice({ id: Date.now(), text: `ベタ焼きは${CONTACT_SHEET_MAX}コマまでです`, error: true });
      return;
    }
    setBusy({ label: "ベタ焼きを焼いています", done: 0, total: list.length });
    try {
      const blob = await renderContactSheet(
        list.map((p) => ({ url: p.url, frame: frameOf.get(p.id) ?? 0, who: p.nickname })),
        {
          title: eventTitle,
          date: new Date(list[0].created_at),
          onProgress: (done, total) => setBusy({ label: "ベタ焼きを焼いています", done, total }),
        },
      );
      setBusy(null);
      const file = new File([blob], safeFileName(`${eventTitle}_ベタ焼き_${list.length}コマ.jpg`), { type: "image/jpeg" });
      const result = await saveFiles([file], `${eventTitle}_ベタ焼き`);
      if (result !== "cancelled") {
        setNotice({ id: Date.now(), text: "ベタ焼きを保存しました" });
        endSelecting();
      }
    } catch (e) {
      setNotice({ id: Date.now(), text: toFriendlyError(e), error: true });
    } finally {
      setBusy(null);
    }
  };

  // ---- 描画 -------------------------------------------------------------------
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

  const mineCount = guestId ? photos.filter((p) => p.guest_id === guestId).length : 0;
  const chips: { id: Filter; label: string; show: boolean }[] = [
    { id: "all", label: `すべて ${photos.length}`, show: true },
    { id: "fav", label: `お気に入り ${myFavs.size}`, show: favReady && !!guestId },
    { id: "mine", label: `自分の写真 ${mineCount}`, show: !!guestId },
  ];

  return (
    <>
      <div className="px-5 pt-2.5 pb-4">
        <h1 className="large-title">現像できました。</h1>
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <p className="text-[15px] text-label-2">
            {photographers.length}人が撮った、{photos.length}コマ。
          </p>
          <div className="flex shrink-0 gap-2">
            {refreshButton}
            <button type="button" onClick={selecting ? endSelecting : () => setSelecting(true)} className="btn-glass" aria-pressed={selecting}>
              {selecting ? "キャンセル" : "選択"}
            </button>
          </div>
        </div>
      </div>

      {/* 絞り込み・選択 */}
      <div className="px-4 pb-3">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {chips
            .filter((c) => c.show)
            .map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setFilter(c.id)}
                aria-pressed={filter === c.id}
                className={`h-8 shrink-0 rounded-full px-3 text-[13px] font-semibold whitespace-nowrap transition ${
                  filter === c.id ? "bg-label text-black" : "bg-surface text-label"
                }`}
              >
                {c.label}
              </button>
            ))}
          <label className="relative shrink-0">
            <span className="sr-only">撮った人で絞り込む</span>
            <select
              value={who}
              onChange={(e) => setWho(e.target.value)}
              className={`h-8 appearance-none rounded-full pr-7 pl-3.5 text-[13px] font-semibold outline-none ${
                who ? "bg-label text-black" : "bg-surface text-label"
              }`}
            >
              <option value="">撮った人</option>
              {photographers.map(([id, p]) => (
                <option key={id} value={id}>
                  {p.name}（{p.count}）
                </option>
              ))}
            </select>
            <ChevronRight
              aria-hidden
              className={`pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 rotate-90 ${who ? "text-black" : "text-label-2"}`}
            />
          </label>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <p className="text-[17px] font-semibold">
            {filter === "fav" ? "お気に入りはまだありません。" : "該当する写真はありません。"}
          </p>
          {filter === "fav" && (
            <p className="mt-2 text-sm text-label-2">写真を開いて♡を押すと、ここに集まります。</p>
          )}
        </div>
      ) : (
        /* ベタ焼き（コンタクトシート）：横に並んだコマがフィルムのストリップになる */
        <ul className={`grid grid-cols-3 gap-y-2 sm:grid-cols-4 lg:grid-cols-5 ${selecting ? "pb-36" : "safe-bottom"}`}>
          {visible.map((p) => {
            const frame = frameOf.get(p.id) ?? 0;
            const count = favCount.get(p.id) ?? 0;
            const isPicked = picked.has(p.id);
            return (
              <li key={p.id} className="animate-fade-in bg-film px-[5px] sm:px-2">
                <Sprockets />
                <p className="cond flex justify-between px-0.5 pb-1 text-[11px] leading-none text-edge/90">
                  <span>▸{frame}</span>
                  <span>{frame}A</span>
                </p>
                <button
                  type="button"
                  onClick={() => (selecting ? togglePick(p.id) : setOpenId(p.id))}
                  aria-pressed={selecting ? isPicked : undefined}
                  className="group relative block w-full overflow-hidden rounded-[2px] bg-black"
                  style={{ aspectRatio: "3 / 4" }}
                  aria-label={`${frame}コマ目、${p.nickname}さんの写真${selecting ? (isPicked ? "（選択中）" : "を選ぶ") : "を開く"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.thumbUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className={`h-full w-full object-cover transition ${selecting && isPicked ? "scale-[0.92] opacity-80" : ""}`}
                  />
                  {count > 0 && (
                    <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold">
                      <Heart className={`size-2.5 ${myFavs.has(p.id) ? "fill-accent text-accent" : ""}`} />
                      {count}
                    </span>
                  )}
                  {selecting && (
                    <span
                      className={`absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full border-2 ${
                        isPicked ? "border-accent bg-accent text-black" : "border-white/80 bg-black/30"
                      }`}
                    >
                      {isPicked && <Check className="size-3.5" strokeWidth={3} />}
                    </span>
                  )}
                </button>
                <p className="truncate px-0.5 pt-1 text-[10px] leading-tight text-edge/80">{p.nickname}</p>
                <Sprockets />
              </li>
            );
          })}
        </ul>
      )}

      {/* 選択中のバー */}
      {selecting && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-separator bg-bg/90 px-4 pt-3 backdrop-blur-md">
          <div className="mx-auto flex max-w-xl flex-col gap-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-label-2">{picked.size}枚を選択</span>
              <button type="button" onClick={pickAll} className="link text-sm">
                {allPicked ? "選択をすべて解除" : "表示中をすべて選択"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => void savePicked()} disabled={picked.size === 0 || !!busy} className="btn-primary h-11 text-[15px]">
                <Download className="size-4" />
                保存
              </button>
              <button
                type="button"
                onClick={() => void makeContactSheet()}
                disabled={picked.size === 0 || picked.size > CONTACT_SHEET_MAX || !!busy}
                className="btn-glass h-11 text-[15px]"
              >
                <Film className="size-4" />
                ベタ焼きにする
              </button>
            </div>
            <p className="text-center text-[11px] text-label-3">
              {picked.size > CONTACT_SHEET_MAX
                ? `ベタ焼きは${CONTACT_SHEET_MAX}コマまでです（いま${picked.size}枚）`
                : `ベタ焼きは選んだ写真を1枚の画像にまとめます（${CONTACT_SHEET_MAX}コマまで）`}
            </p>
          </div>
        </div>
      )}

      {/* 準備中 */}
      {busy && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70" role="status" aria-live="polite">
          <div className="flex min-w-56 flex-col items-center gap-3 rounded-2xl bg-surface px-8 py-6">
            <Loader2 className="size-7 animate-spin text-accent" />
            <p className="text-[15px] font-semibold">{busy.label}</p>
            <p className="text-sm text-label-2 tabular-nums">
              {busy.done} / {busy.total}
            </p>
          </div>
        </div>
      )}

      {notice && (
        <div
          key={notice.id}
          role="status"
          className={`pointer-events-none fixed inset-x-0 z-[70] mx-auto w-fit max-w-[90%] animate-fade-in rounded-full px-4 py-2 text-sm font-semibold shadow-lg ${
            selecting ? "bottom-44" : "bottom-10"
          } ${notice.error ? "bg-danger text-black" : "bg-label text-black"}`}
        >
          {notice.text}
        </div>
      )}

      {openIndex >= 0 && (
        <PhotoModal
          photos={visible}
          index={openIndex}
          frameOf={frameOf}
          eventTitle={eventTitle}
          favorite={
            favReady && guestId
              ? { on: myFavs.has(visible[openIndex].id), count: favCount.get(visible[openIndex].id) ?? 0, toggle: toggleFavorite }
              : null
          }
          onChange={(i) => setOpenId(visible[i]?.id ?? null)}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

type ModalProps = {
  photos: GalleryPhoto[];
  index: number;
  frameOf: Map<string, number>;
  eventTitle: string;
  favorite: { on: boolean; count: number; toggle: (photo: GalleryPhoto) => void } | null;
  onChange: (index: number) => void;
  onClose: () => void;
};

function PhotoModal({ photos, index, frameOf, eventTitle, favorite, onChange, onClose }: ModalProps) {
  const photo = photos[index];
  const frame = frameOf.get(photo.id) ?? 0;
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
      const stamp = photo.created_at.slice(0, 19).replace(/[-:T]/g, "");
      const file = await fetchAsFile(photo.url, `${eventTitle}_${photo.nickname}_${stamp}`);
      await saveFiles([file], file.name);
    } catch (e) {
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
            {frame}コマ目　{formatTime(photo.created_at)}
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
          onDoubleClick={() => favorite && !favorite.on && favorite.toggle(photo)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.url}
            alt={`${photo.nickname}さんが撮影した写真`}
            className="block max-h-[calc(100dvh-15rem)] w-auto max-w-[calc(100vw-3rem)] object-contain"
          />
          <figcaption className="absolute inset-x-3 bottom-2.5 flex items-baseline justify-between text-ink sm:bottom-3.5">
            <span className="truncate text-xs font-semibold">{eventTitle}</span>
            <span className="cond text-sm text-muted">No.{frame}</span>
          </figcaption>
        </figure>
      </div>

      <footer className="safe-bottom flex flex-col items-center px-5 pt-3">
        <div className="flex w-full max-w-sm items-center justify-around">
          <button type="button" onClick={prev} disabled={index === 0} aria-label="前の写真" className="grid size-11 place-items-center disabled:opacity-30">
            <ChevronLeft className="size-6" />
          </button>
          {favorite && (
            <button
              type="button"
              onClick={() => favorite.toggle(photo)}
              aria-pressed={favorite.on}
              aria-label={favorite.on ? "お気に入りから外す" : "お気に入りにする"}
              className="flex h-11 min-w-11 items-center justify-center gap-1"
            >
              <Heart className={`size-6 transition ${favorite.on ? "scale-110 fill-accent text-accent" : ""}`} />
              {favorite.count > 0 && <span className="text-sm tabular-nums text-label-2">{favorite.count}</span>}
            </button>
          )}
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
