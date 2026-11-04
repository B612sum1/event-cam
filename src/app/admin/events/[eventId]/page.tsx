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
import { LanguageToggle } from "@/components/LanguageToggle";
import { QRCodeDisplay } from "@/components/QRCodeDisplay";
import { StatusScreen } from "@/components/StatusScreen";
import { useI18n } from "@/lib/i18n";
import { getCurrentUserId, getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  formatDateTime,
  formatShootWindow,
  formatTime,
  getShootingState,
  isRevealed,
  isUuid,
  toFriendlyError,
} from "@/lib/utils/format";
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
  const { t, lang } = useI18n();
  const a = t.admin;
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
        if (!cancelled) setState({ status: "error", message: toFriendlyError(e, lang) });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 言語を切り替えても読み直さない
  }, [eventId]);

  // 現像状態の表示を定期的に更新
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  // ---- 集計 + Realtime ----------------------------------------------------
  const ready = state.status === "ready";

  const loadStats = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("guests")
      .select("id, nickname, created_at, photos!photos_guest_id_fkey(count)")
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

  // 撮影の締め切り・再開
  const [confirmClose, setConfirmClose] = useState(false);
  const [shootError, setShootError] = useState<string | null>(null);
  const updateShooting = async (patch: { shoot_start_at?: string | null; shoot_end_at: string | null }) => {
    if (state.status !== "ready") return;
    setShootError(null);
    const { data, error } = await getSupabaseBrowserClient()
      .from("events")
      .update(patch)
      .eq("id", state.event.id)
      .select("*")
      .single();
    setConfirmClose(false);
    if (error) setShootError(toFriendlyError(error, lang));
    else if (data) {
      setState({ status: "ready", event: data });
      setNow(Date.now());
    }
  };
  const closeShootingNow = () => {
    if (state.status !== "ready") return;
    const start = state.event.shoot_start_at;
    // まだ始まっていない場合は、開始時刻も外して「今で締め切り」にする
    void updateShooting({
      shoot_end_at: new Date().toISOString(),
      ...(start && new Date(start).getTime() > Date.now() ? { shoot_start_at: null } : {}),
    });
  };
  const reopenShooting = () => void updateShooting({ shoot_end_at: null });

  // ---- 描画 ----------------------------------------------------------------
  if (state.status === "loading") return <StatusScreen kind="loading" />;
  if (state.status === "not-found") return <StatusScreen title={t.common.eventNotFound} action={{ href: "/admin/create", label: a.notFoundAction }} />;
  if (state.status === "forbidden")
    return (
      <StatusScreen title={a.forbidden} action={{ href: "/", label: a.toTop }}>
        {a.forbiddenBody}
      </StatusScreen>
    );
  if (state.status === "error") return <StatusScreen title={t.common.loadFailed}>{state.message}</StatusScreen>;

  const { event } = state;
  const revealed = isRevealed(event.reveal_at, now);
  const shooting = getShootingState(event, now);
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
            {t.common.top}
          </Link>
          <div className="flex items-center gap-3">
            <LanguageToggle />
            <Wordmark />
          </div>
        </header>

        <div className="mx-auto w-full max-w-5xl px-5 pt-3 pb-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[13px] text-label-2">{a.heading}</p>
              <h1 className="large-title mt-1">{event.title}</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/event/${event.id}/gallery`} className="btn-glass">
                <Images className="size-4" /> {t.common.gallery}
              </Link>
              <Link href={`/event/${event.id}/join`} className="btn-glass">
                <Camera className="size-4" /> {a.joinToo}
              </Link>
            </div>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[340px_1fr]">
            {/* QR */}
            <section className="flex flex-col items-center rounded-2xl bg-surface p-6 text-center">
              <h2 className="text-[15px] font-semibold">{a.qr}</h2>
              <div className="mt-5">
                <QRCodeDisplay value={joinUrl} size={220} className="shadow-none" title={a.qrTitle} />
              </div>
              <p className="mt-4 text-[11px] break-all text-label-3">{joinUrl}</p>
              <div className="mt-5 grid w-full gap-2">
                <button type="button" onClick={() => window.print()} className="btn-primary w-full">
                  <Printer className="size-4" /> {a.print}
                </button>
                <button type="button" onClick={copyLink} className="btn-glass h-11 w-full">
                  {copied ? <Check className="size-4 text-accent" /> : <Copy className="size-4" />}
                  {copied ? a.copied : a.copy}
                </button>
              </div>
              <a href={joinUrl} target="_blank" rel="noreferrer" className="link mt-4 text-sm">
                {a.openJoin} <ExternalLink className="size-3.5" />
              </a>
            </section>

            <div className="space-y-6">
              {/* 数字 */}
              <section className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-separator">
                <Counter label={a.guests} value={guests.length} unit={a.people} />
                <Counter label={a.photos} value={photoCount} unit={a.shotsUnit} />
                <Counter label={a.perGuest} value={event.max_photos_per_guest} unit={a.shotsUnit} />
              </section>

              {/* 撮影できる時間 */}
              <section>
                <div className="mb-2 flex items-center justify-between px-4">
                  <h2 className="text-[13px] text-label-2">{a.window}</h2>
                  <span
                    className={`text-[13px] font-semibold ${
                      shooting === "open" ? "text-teal-light" : shooting === "before" ? "text-accent" : "text-label-3"
                    }`}
                  >
                    {shooting === "open" ? a.shooting : shooting === "before" ? a.before : a.closed}
                  </span>
                </div>
                <div className="rounded-2xl bg-surface p-5">
                  <p className="text-[17px] font-semibold">{formatShootWindow(event.shoot_start_at, event.shoot_end_at, lang)}</p>
                  <p className="mt-1 text-[13px] text-label-2">
                    {shooting === "closed"
                      ? a.closedNote
                      : a.openNote}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    {shooting === "closed" ? (
                      <button type="button" onClick={reopenShooting} className="btn-glass h-11 px-5">
                        {a.reopen}
                      </button>
                    ) : confirmClose ? (
                      <>
                        <span className="w-full text-center text-sm text-label-2">{a.closeConfirm}</span>
                        <button type="button" onClick={closeShootingNow} className="btn-primary h-11">
                          {a.closeNow}
                        </button>
                        <button type="button" onClick={() => setConfirmClose(false)} className="btn-glass h-11 px-5">
                          {t.common.cancel}
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setConfirmClose(true)} className="btn-glass h-11 px-5">
                        {a.closeNow}
                      </button>
                    )}
                  </div>
                  {shootError && <p className="mt-2 text-center text-sm text-danger">{shootError}</p>}
                </div>
              </section>

              {/* 現像 */}
              <section>
                <div className="mb-2 flex items-center justify-between px-4">
                  <h2 className="text-[13px] text-label-2">{a.reveal}</h2>
                  <span className={`text-[13px] font-semibold ${revealed ? "text-teal-light" : "text-accent"}`}>
                    {revealed ? a.public : a.developing}
                  </span>
                </div>
                <div className="rounded-2xl bg-surface p-5">
                  {event.reveal_at && !revealed ? (
                    <>
                      <p className="text-[15px] text-label-2">{a.revealsAt(formatDateTime(event.reveal_at, lang))}</p>
                      <div className="mt-4">
                        <CountdownTimer target={event.reveal_at} onComplete={() => setNow(Date.now())} />
                      </div>
                      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                        {confirmReveal ? (
                          <>
                            <span className="w-full text-center text-sm text-label-2">{a.revealConfirm}</span>
                            <button type="button" onClick={revealNow} className="btn-primary h-11">
                              {a.revealNow}
                            </button>
                            <button type="button" onClick={() => setConfirmReveal(false)} className="btn-glass h-11 px-5">
                              {t.common.cancel}
                            </button>
                          </>
                        ) : (
                          <button type="button" onClick={() => setConfirmReveal(true)} className="btn-glass h-11 px-5">
                            {a.revealNow}
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-[15px] leading-relaxed text-label-2">
                      {a.publicNote}
                    </p>
                  )}
                </div>
              </section>

              {/* 参加者一覧 */}
              <section>
                <div className="mb-2 flex items-center justify-between px-4">
                  <h2 className="text-[13px] text-label-2">{a.guests}</h2>
                  <span className="inline-flex items-center gap-1.5 text-[13px] text-label-2">
                    <span className="size-1.5 animate-pulse rounded-full bg-teal-light" />
                    {a.live}
                  </span>
                </div>
                {guests.length === 0 ? (
                  <div className="rounded-2xl bg-surface px-5 py-8 text-center text-[15px] text-label-2">
                    {a.noGuests}
                  </div>
                ) : (
                  <ul className="group-list">
                    {[...guests].reverse().map((g) => (
                      <li key={g.id} className="group-row">
                        <span className="min-w-0 flex-1 truncate">{g.nickname}</span>
                        <span className="text-[13px] text-label-3">{formatTime(g.created_at, lang)}</span>
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
        <h1 className="mt-6 text-5xl leading-tight font-bold tracking-[-0.025em]">{t.join.headline}</h1>
        <p className="mt-3 text-xl text-muted">{t.join.lead(event.title)}</p>
        <CameraIllustration className="mt-14 max-w-[330px]" shots={event.max_photos_per_guest} spotlight={false} />
        <div className="flex-1" />
        <div className="flex items-center gap-7 rounded-3xl bg-[#f5f5f7] p-6 text-left">
          <QRCodeDisplay value={joinUrl} size={170} className="shadow-none" title={a.qrTitle} />
          <div className="flex flex-col gap-2.5">
            <p className="text-2xl leading-snug font-bold">
              {a.cardScan1}
              <br />
              {a.cardScan2}
            </p>
            <p className="text-sm leading-relaxed text-muted">
              {a.cardLimit(event.max_photos_per_guest)}
              {event.shoot_end_at ? a.cardWindow(formatShootWindow(event.shoot_start_at, event.shoot_end_at, lang)) : ""}
              {event.reveal_at ? a.cardReveal(formatDateTime(event.reveal_at, lang)) : ""}
              <br />
              {a.cardNoApp}
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
