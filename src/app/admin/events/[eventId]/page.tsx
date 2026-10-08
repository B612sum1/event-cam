"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  Camera,
  Check,
  Copy,
  ExternalLink,
  Images,
  Printer,
} from "lucide-react";
import { CameraIllustration } from "@/components/CameraIllustration";
import { Wordmark } from "@/components/Carton";
import { CountdownTimer } from "@/components/CountdownTimer";
import { QRCodeDisplay } from "@/components/QRCodeDisplay";
import { StatusScreen } from "@/components/StatusScreen";
import { getCurrentUserId, getSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatDateTime, formatTime, isRevealed, isUuid, toFriendlyError } from "@/lib/utils/format";
import type { EventRow } from "@/types";

type GuestSummary = { id: string; nickname: string; created_at: string; photoCount: number };

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "forbidden" }
  | { status: "error"; message: string }
  | { status: "ready"; event: EventRow };

export default function AdminEventPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [guests, setGuests] = useState<GuestSummary[]>([]);
  const [photoCount, setPhotoCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState<number>(() => Date.now());

  // ---- イベント読み込み（主催者のみ） ---------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isUuid(eventId)) return setState({ status: "not-found" });
      try {
        const supabase = getSupabaseBrowserClient();
        const userId = await getCurrentUserId(supabase);
        const { data: pub } = await supabase.rpc("get_event_public", { p_event_id: eventId });
        if (!pub?.[0]) return !cancelled && setState({ status: "not-found" });
        if (!userId) return !cancelled && setState({ status: "forbidden" });

        const { data, error } = await supabase
          .from("events")
          .select("*")
          .eq("id", eventId)
          .eq("owner_uid", userId)
          .maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        setState(data ? { status: "ready", event: data } : { status: "forbidden" });
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: toFriendlyError(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // 現像状態の表示を定期的に更新
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // ---- 集計 + Realtime ----------------------------------------------------
  const ready = state.status === "ready";

  const loadStats = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("guests")
      .select("id, nickname, created_at, photos(count)")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });
    if (error || !data) return;
    const list: GuestSummary[] = data.map((g) => ({
      id: g.id,
      nickname: g.nickname,
      created_at: g.created_at,
      photoCount: g.photos?.[0]?.count ?? 0,
    }));
    setGuests(list);
    setPhotoCount(list.reduce((sum, g) => sum + g.photoCount, 0));
  }, [eventId]);

  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!ready) return;

    const supabase = getSupabaseBrowserClient();
    const schedule = () => {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => void loadStats(), 400);
    };
    const channel = supabase
      .channel(`admin:${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "photos", filter: `event_id=eq.${eventId}` }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "guests", filter: `event_id=eq.${eventId}` }, schedule)
      // 購読が確立してから初回集計（その間の変更を取りこぼさない）
      .subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") void loadStats();
      });

    return () => {
      window.clearTimeout(debounceRef.current);
      void supabase.removeChannel(channel);
    };
  }, [ready, eventId, loadStats]);

  // ---- 操作 ----------------------------------------------------------------
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* noop */
    }
  };

  const [confirmReveal, setConfirmReveal] = useState(false);
  const revealNow = async () => {
    if (state.status !== "ready") return;
    const { data, error } = await getSupabaseBrowserClient()
      .from("events")
      .update({ reveal_at: new Date().toISOString() })
      .eq("id", state.event.id)
      .select("*")
      .single();
    setConfirmReveal(false);
    if (!error && data) setState({ status: "ready", event: data });
  };

  // ---- 描画 ----------------------------------------------------------------
  if (state.status === "loading") return <StatusScreen kind="loading" />;
  if (state.status === "not-found") return <StatusScreen title="イベントが見つかりません" action={{ href: "/admin/create", label: "イベントを作成" }} />;
  if (state.status === "forbidden")
    return (
      <StatusScreen title="管理権限がありません" action={{ href: "/", label: "トップへ" }}>
        管理画面は、このイベントを作成したブラウザからのみ開けます。
      </StatusScreen>
    );
  if (state.status === "error") return <StatusScreen title="読み込みに失敗しました">{state.message}</StatusScreen>;

  const { event } = state;
  const revealed = isRevealed(event.reveal_at, now);
  // ここに来るのはクライアントでの読み込み完了後のみなので window を参照してよい
  const siteBase = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || window.location.origin;
  const joinUrl = `${siteBase}/event/${event.id}/join`;

  return (
    <>
      {/* ============ 画面表示 ============ */}
      <main className="safe-top safe-bottom flex min-h-dvh flex-1 flex-col bg-bg print:hidden">
        <header className="mx-auto flex h-[52px] w-full max-w-5xl items-center justify-between px-4">
          <Link href="/" className="link h-11">
            <ChevronLeft className="size-5" />
            トップ
          </Link>
          <Wordmark />
        </header>

        <div className="mx-auto w-full max-w-5xl px-5 pt-3 pb-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[13px] text-label-2">管理画面</p>
              <h1 className="large-title mt-1">{event.title}</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/event/${event.id}/gallery`} className="btn-glass">
                <Images className="size-4" /> ギャラリー
              </Link>
              <Link href={`/event/${event.id}/join`} className="btn-glass">
                <Camera className="size-4" /> 自分も撮る
              </Link>
            </div>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[340px_1fr]">
            {/* QR */}
            <section className="flex flex-col items-center rounded-2xl bg-surface p-6 text-center">
              <h2 className="text-[15px] font-semibold">参加用QRコード</h2>
              <div className="mt-5">
                <QRCodeDisplay value={joinUrl} size={220} className="shadow-none" />
              </div>
              <p className="mt-4 text-[11px] break-all text-label-3">{joinUrl}</p>
              <div className="mt-5 grid w-full gap-2">
                <button type="button" onClick={() => window.print()} className="btn-primary w-full">
                  <Printer className="size-4" /> 卓上カードを印刷
                </button>
                <button type="button" onClick={copyLink} className="btn-glass h-11 w-full">
                  {copied ? <Check className="size-4 text-accent" /> : <Copy className="size-4" />}
                  {copied ? "コピーしました" : "リンクをコピー"}
                </button>
              </div>
              <a href={joinUrl} target="_blank" rel="noreferrer" className="link mt-4 text-sm">
                参加ページを開く <ExternalLink className="size-3.5" />
              </a>
            </section>

            <div className="space-y-6">
              {/* 数字 */}
              <section className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-separator">
                <Counter label="参加者" value={guests.length} unit="人" />
                <Counter label="撮影枚数" value={photoCount} unit="枚" />
                <Counter label="1人あたり" value={event.max_photos_per_guest} unit="枚" />
              </section>

              {/* 現像 */}
              <section>
                <div className="mb-2 flex items-center justify-between px-4">
                  <h2 className="text-[13px] text-label-2">現像</h2>
                  <span className={`text-[13px] font-semibold ${revealed ? "text-teal-light" : "text-accent"}`}>
                    {revealed ? "公開中" : "現像中"}
                  </span>
                </div>
                <div className="rounded-2xl bg-surface p-5">
                  {event.reveal_at && !revealed ? (
                    <>
                      <p className="text-[15px] text-label-2">{formatDateTime(event.reveal_at)} に公開</p>
                      <div className="mt-4">
                        <CountdownTimer target={event.reveal_at} onComplete={() => setNow(Date.now())} />
                      </div>
                      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                        {confirmReveal ? (
                          <>
                            <span className="w-full text-center text-sm text-label-2">全員に公開します。よろしいですか？</span>
                            <button type="button" onClick={revealNow} className="btn-primary h-11">
                              今すぐ現像する
                            </button>
                            <button type="button" onClick={() => setConfirmReveal(false)} className="btn-glass h-11 px-5">
                              やめる
                            </button>
                          </>
                        ) : (
                          <button type="button" onClick={() => setConfirmReveal(true)} className="btn-glass h-11 px-5">
                            今すぐ現像する
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-[15px] leading-relaxed text-label-2">
                      写真はギャラリーで公開中です。新しく撮られた写真も、すぐに追加されます。
                    </p>
                  )}
                </div>
              </section>

              {/* 参加者一覧 */}
              <section>
                <div className="mb-2 flex items-center justify-between px-4">
                  <h2 className="text-[13px] text-label-2">参加者</h2>
                  <span className="inline-flex items-center gap-1.5 text-[13px] text-label-2">
                    <span className="size-1.5 animate-pulse rounded-full bg-teal-light" />
                    自動で更新
                  </span>
                </div>
                {guests.length === 0 ? (
                  <div className="rounded-2xl bg-surface px-5 py-8 text-center text-[15px] text-label-2">
                    まだ誰も参加していません。QRコードを置いてみましょう。
                  </div>
                ) : (
                  <ul className="group-list">
                    {[...guests].reverse().map((g) => (
                      <li key={g.id} className="group-row">
                        <span className="min-w-0 flex-1 truncate">{g.nickname}</span>
                        <span className="text-[13px] text-label-3">{formatTime(g.created_at)}</span>
                        <span className="w-16 text-right text-label-2 tabular-nums">
                          {g.photoCount} / {event.max_photos_per_guest}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </div>
      </main>

      {/* ============ 印刷用（卓上カード） ============ */}
      <section className="hidden min-h-[265mm] flex-col items-center px-10 pt-12 pb-10 text-center text-ink print:flex">
        <Wordmark size="md" tone="light" />
        <h1 className="mt-6 text-5xl leading-tight font-bold tracking-[-0.025em]">撮って、待って、現像。</h1>
        <p className="mt-3 text-xl text-muted">{event.title} の、今日だけのカメラ。</p>
        <CameraIllustration className="mt-14 max-w-[330px]" shots={event.max_photos_per_guest} spotlight={false} />
        <div className="flex-1" />
        <div className="flex items-center gap-7 rounded-3xl bg-[#f5f5f7] p-6 text-left">
          <QRCodeDisplay value={joinUrl} size={170} className="shadow-none" />
          <div className="flex flex-col gap-2.5">
            <p className="text-2xl leading-snug font-bold">
              スマホのカメラで
              <br />
              読み取ってください。
            </p>
            <p className="text-sm leading-relaxed text-muted">
              ひとり{event.max_photos_per_guest}枚まで。
              {event.reveal_at ? `現像は ${formatDateTime(event.reveal_at)}。` : ""}
              <br />
              アプリも登録もいりません。
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

function Counter({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="flex flex-col items-center bg-surface px-2 py-5">
      <span className="text-[13px] text-label-2">{label}</span>
      <span className="mt-1.5 flex items-baseline gap-0.5">
        <span className="text-[40px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{value}</span>
        <span className="text-[13px] text-label-2">{unit}</span>
      </span>
    </div>
  );
}
