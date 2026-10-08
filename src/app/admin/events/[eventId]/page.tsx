"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Check,
  Copy,
  ExternalLink,
  Images,
  Printer,
  Sparkles,
  Users,
} from "lucide-react";
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
      <main className="paper-grain flex min-h-dvh flex-1 flex-col px-5 py-8 print:hidden">
        <div className="mx-auto w-full max-w-5xl">
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted">
            <ArrowLeft className="size-4" /> トップ
          </Link>

          <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs tracking-[0.3em] text-gold">DASHBOARD</p>
              <h1 className="mt-2 font-serif text-3xl tracking-wide">{event.title}</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/event/${event.id}/gallery`} className="btn-ghost">
                <Images className="size-4" /> ギャラリー
              </Link>
              <Link href={`/event/${event.id}/join`} className="btn-ghost">
                <Camera className="size-4" /> 自分も撮影に参加
              </Link>
            </div>
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-[360px_1fr]">
            {/* QR */}
            <section className="rounded-3xl border border-line bg-card p-6 text-center">
              <h2 className="text-sm font-medium">参加用QRコード</h2>
              <div className="mt-5 flex justify-center">
                {joinUrl ? <QRCodeDisplay value={joinUrl} size={232} /> : <div className="size-[264px]" />}
              </div>
              <p className="mt-4 break-all font-mono text-[11px] text-muted">{joinUrl}</p>
              <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <button type="button" onClick={copyLink} className="btn-ghost justify-center">
                  {copied ? <Check className="size-4 text-accent" /> : <Copy className="size-4" />}
                  {copied ? "コピーしました" : "リンクをコピー"}
                </button>
                <button type="button" onClick={() => window.print()} className="btn-primary justify-center">
                  <Printer className="size-4" /> 印刷する
                </button>
              </div>
              <a
                href={joinUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-xs text-muted underline-offset-4 hover:underline"
              >
                参加ページを開く <ExternalLink className="size-3" />
              </a>
            </section>

            <div className="space-y-5">
              {/* 数字 */}
              <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="参加者" value={guests.length} unit="人" />
                <Stat label="撮影枚数" value={photoCount} unit="枚" />
                <div className="col-span-2 rounded-3xl border border-line bg-card p-5 sm:col-span-1">
                  <p className="text-xs text-muted">1人あたり上限</p>
                  <p className="mt-2 font-serif text-4xl tabular-nums">
                    {event.max_photos_per_guest}
                    <span className="ml-1 text-base text-muted">枚</span>
                  </p>
                </div>
              </section>

              {/* 現像 */}
              <section className="rounded-3xl border border-line bg-card p-6">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-accent" />
                  <h2 className="text-sm font-medium">現像</h2>
                  <span
                    className={`ml-auto rounded-full px-2.5 py-1 text-[11px] ${
                      revealed ? "bg-accent/10 text-accent" : "bg-paper-2 text-muted"
                    }`}
                  >
                    {revealed ? "公開中" : "現像中"}
                  </span>
                </div>
                {event.reveal_at && !revealed ? (
                  <>
                    <p className="mt-3 text-sm text-muted">{formatDateTime(event.reveal_at)} に一斉公開</p>
                    <div className="mt-6">
                      <CountdownTimer target={event.reveal_at} onComplete={() => setNow(Date.now())} />
                    </div>
                    <div className="mt-6 flex justify-center">
                      {confirmReveal ? (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-muted">全員に公開します。よろしいですか？</span>
                          <button type="button" onClick={revealNow} className="btn-primary">
                            今すぐ現像
                          </button>
                          <button type="button" onClick={() => setConfirmReveal(false)} className="btn-ghost">
                            やめる
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setConfirmReveal(true)} className="btn-ghost">
                          今すぐ現像する
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="mt-3 text-sm text-muted">
                    写真はギャラリーで公開されています。新しく撮影された写真もリアルタイムで追加されます。
                  </p>
                )}
              </section>

              {/* 参加者一覧 */}
              <section className="rounded-3xl border border-line bg-card p-6">
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-muted" />
                  <h2 className="text-sm font-medium">参加者</h2>
                  <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted">
                    <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                    リアルタイム更新
                  </span>
                </div>
                {guests.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted">まだ参加者はいません。QRコードを共有しましょう。</p>
                ) : (
                  <ul className="mt-4 divide-y divide-line">
                    {[...guests].reverse().map((g) => (
                      <li key={g.id} className="flex items-center gap-3 py-2.5 text-sm">
                        <span className="min-w-0 flex-1 truncate">{g.nickname}</span>
                        <span className="text-xs text-muted">{formatTime(g.created_at)} 参加</span>
                        <span className="w-24 text-right">
                          <span className="font-medium tabular-nums">{g.photoCount}</span>
                          <span className="text-muted"> / {event.max_photos_per_guest}枚</span>
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

      {/* ============ 印刷用（テーブル設置カード） ============ */}
      <section className="hidden print:flex print:min-h-[260mm] print:flex-col print:items-center print:justify-center print:text-center">
        <p style={{ letterSpacing: "0.35em" }} className="text-sm">
          SHARE YOUR MOMENTS
        </p>
        <h1 className="mt-4 font-serif text-4xl">{event.title}</h1>
        <p className="mt-6 text-lg">スマホのカメラでQRコードを読み取って、</p>
        <p className="text-lg">今日の写真を撮ってください。</p>
        <div className="mt-10">{joinUrl && <QRCodeDisplay value={joinUrl} size={320} className="shadow-none" />}</div>
        <p className="mt-8 text-base">
          ひとり {event.max_photos_per_guest} 枚まで
          {event.reveal_at ? `・${formatDateTime(event.reveal_at)} に一斉現像` : ""}
        </p>
        <p className="mt-2 text-xs">アプリのインストール・会員登録は不要です</p>
      </section>
    </>
  );
}

function Stat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="rounded-3xl border border-line bg-card p-5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-2 font-serif text-4xl tabular-nums">
        {value}
        <span className="ml-1 text-base text-muted">{unit}</span>
      </p>
    </div>
  );
}
