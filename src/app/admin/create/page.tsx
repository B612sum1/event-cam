"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { Wordmark } from "@/components/Carton";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useI18n, type Messages } from "@/lib/i18n";
import { ensureAnonymousUser, getSupabaseBrowserClient } from "@/lib/supabase/client";
import { toDateTimeLocalValue, toFriendlyError } from "@/lib/utils/format";

const PHOTO_PRESETS = [10, 15, 24, 27];

type RevealMode = "scheduled" | "immediate";
type StartMode = "now" | "scheduled";
type EndMode = "reveal" | "scheduled" | "none";

function quickTimes(m: Messages["create"]): { label: string; value: string }[] {
  const now = new Date();
  const roundUp = (d: Date) => {
    const r = new Date(d);
    r.setSeconds(0, 0);
    r.setMinutes(Math.ceil(r.getMinutes() / 15) * 15);
    return r;
  };
  const inHours = (h: number) => roundUp(new Date(now.getTime() + h * 3600_000));
  const tomorrow9 = new Date(now);
  tomorrow9.setDate(now.getDate() + 1);
  tomorrow9.setHours(9, 0, 0, 0);
  return [
    { label: m.in3h, value: toDateTimeLocalValue(inHours(3)) },
    { label: m.in5h, value: toDateTimeLocalValue(inHours(5)) },
    { label: m.tomorrow9, value: toDateTimeLocalValue(tomorrow9) },
  ];
}

export default function CreateEventPage() {
  const router = useRouter();
  const { t, lang } = useI18n();
  const m = t.create;
  const [title, setTitle] = useState("");
  const [maxPhotos, setMaxPhotos] = useState(15);
  const [mode, setMode] = useState<RevealMode>("scheduled");
  const [revealLocal, setRevealLocal] = useState("");
  const [startMode, setStartMode] = useState<StartMode>("now");
  const [startLocal, setStartLocal] = useState("");
  const [endMode, setEndMode] = useState<EndMode>("reveal");
  const [endLocal, setEndLocal] = useState("");
  // 「撮ってすぐ」公開のときは「現像の時間まで」が選べないので「決めない」扱い
  const effectiveEnd: EndMode = endMode === "reveal" && mode !== "scheduled" ? "none" : endMode;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = title.trim();
    if (!trimmed) return setError(m.errName);
    if (!Number.isInteger(maxPhotos) || maxPhotos < 1 || maxPhotos > 100)
      return setError(m.errShots);

    let revealAt: string | null = null;
    if (mode === "scheduled") {
      if (!revealLocal) return setError(m.errRevealMissing);
      const d = new Date(revealLocal); // datetime-local は端末のタイムゾーンとして解釈される
      if (Number.isNaN(d.getTime())) return setError(m.errRevealInvalid);
      if (d.getTime() <= Date.now()) return setError(m.errRevealPast);
      revealAt = d.toISOString();
    }

    const parseLocal = (value: string, missing: string, invalid: string) => {
      if (!value) throw new Error(missing);
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) throw new Error(invalid);
      return d;
    };
    let shootStartAt: string | null = null;
    let shootEndAt: string | null = null;
    try {
      if (startMode === "scheduled") shootStartAt = parseLocal(startLocal, m.errStartMissing, m.errStartInvalid).toISOString();
      if (effectiveEnd === "reveal") shootEndAt = revealAt;
      if (effectiveEnd === "scheduled") {
        const end = parseLocal(endLocal, m.errEndMissing, m.errEndInvalid);
        if (end.getTime() <= Date.now()) return setError(m.errEndPast);
        shootEndAt = end.toISOString();
      }
    } catch (err) {
      return setError(err instanceof Error ? err.message : String(err));
    }
    if (shootStartAt && shootEndAt && new Date(shootStartAt) >= new Date(shootEndAt))
      return setError(m.errOrder);

    setSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const user = await ensureAnonymousUser(supabase);
      const { data, error: insertError } = await supabase
        .from("events")
        .insert({
          title: trimmed,
          max_photos_per_guest: maxPhotos,
          reveal_at: revealAt,
          shoot_start_at: shootStartAt,
          shoot_end_at: shootEndAt,
          owner_uid: user.id,
        })
        .select("id")
        .single();
      if (insertError) throw insertError;
      router.push(`/admin/events/${data.id}`);
    } catch (err) {
      setError(toFriendlyError(err, lang));
      setSubmitting(false);
    }
  };

  return (
    <main className="safe-top safe-bottom flex min-h-dvh flex-1 flex-col bg-bg">
      <header className="mx-auto flex h-[52px] w-full max-w-lg items-center justify-between px-4">
        <Link href="/" className="link h-11">
          <ChevronLeft className="size-5" />
          {t.common.top}
        </Link>
        <div className="flex items-center gap-3">
          <LanguageToggle />
          <Wordmark />
        </div>
      </header>

      <div className="mx-auto w-full max-w-lg px-5 pt-3 pb-10">
        <h1 className="large-title">{m.title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-label-2">
          {m.lead}
        </p>

        <form onSubmit={submit} className="mt-8 space-y-8">
          <Section label={m.name}>
            <div className="group-list">
              <div className="group-row h-[50px]">
                <input
                  id="title"
                  aria-label={m.name}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={100}
                  required
                  placeholder="Taro & Hanako Wedding"
                  className="min-w-0 flex-1 bg-transparent text-base outline-none"
                />
              </div>
            </div>
          </Section>

          <Section label={m.shots} hint={m.shotsHint}>
            <div className="flex flex-wrap gap-2">
              {PHOTO_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMaxPhotos(n)}
                  aria-pressed={maxPhotos === n}
                  className={`h-10 rounded-full px-4 text-[15px] font-semibold transition ${
                    maxPhotos === n ? "bg-label text-black" : "bg-surface text-label"
                  }`}
                >
                  {t.common.shotsRoll(n)}
                </button>
              ))}
            </div>
            <div className="group-list mt-3">
              <div className="group-row h-[50px]">
                <label htmlFor="max">{m.shotsInput}</label>
                <span className="flex items-center gap-1 text-label-2">
                  <input
                    id="max"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100}
                    value={Number.isNaN(maxPhotos) ? "" : maxPhotos}
                    onChange={(e) => setMaxPhotos(e.target.valueAsNumber)}
                    className="w-14 bg-transparent text-right text-base text-label outline-none"
                  />
                  {m.shotsUnit}
                </span>
              </div>
            </div>
          </Section>

          <Section label={m.reveal}>
            <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-surface p-1" role="radiogroup" aria-label={m.reveal}>
              {(
                [
                  { v: "scheduled", t: m.revealScheduled },
                  { v: "immediate", t: m.revealInstant },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  role="radio"
                  aria-checked={mode === o.v}
                  onClick={() => setMode(o.v)}
                  className={`h-9 rounded-[7px] text-sm font-semibold transition ${
                    mode === o.v ? "bg-surface-2 text-label shadow-[0_1px_3px_rgb(0_0_0/0.4)]" : "text-label-2"
                  }`}
                >
                  {o.t}
                </button>
              ))}
            </div>
            <p className="mt-2 px-4 text-[13px] text-label-2">
              {mode === "scheduled" ? m.revealScheduledNote : m.revealInstantNote}
            </p>

            {mode === "scheduled" && (
              <div className="mt-3 space-y-3">
                <div className="group-list">
                  <div className="group-row h-[50px]">
                    <label htmlFor="reveal" className="shrink-0">{m.revealAt}</label>
                    <input
                      id="reveal"
                      type="datetime-local"
                      value={revealLocal}
                      onChange={(e) => setRevealLocal(e.target.value)}
                      className="min-w-0 bg-transparent text-right text-base text-label-2 outline-none [color-scheme:dark]"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 px-1">
                  {quickTimes(m).map((q) => (
                    <button key={q.label} type="button" onClick={() => setRevealLocal(q.value)} className="btn-glass">
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Section>

          <Section label={m.window} hint={m.windowHint}>
            <div className="space-y-3">
              <div className="group-list">
                <div className="group-row h-[50px]">
                  <span className="shrink-0">{m.start}</span>
                  <Segmented
                    label={m.startLabel}
                    value={startMode}
                    onChange={setStartMode}
                    options={[
                      { v: "now", t: m.startNow },
                      { v: "scheduled", t: m.pickTime },
                    ]}
                  />
                </div>
                {startMode === "scheduled" && (
                  <div className="group-row h-[50px]">
                    <label htmlFor="shoot-start" className="shrink-0 text-label-2">
                      {m.startAt}
                    </label>
                    <input
                      id="shoot-start"
                      type="datetime-local"
                      value={startLocal}
                      onChange={(e) => setStartLocal(e.target.value)}
                      className="min-w-0 bg-transparent text-right text-base text-label-2 outline-none [color-scheme:dark]"
                    />
                  </div>
                )}
              </div>

              <div className="group-list">
                <div className="group-row h-[50px]">
                  <span className="shrink-0">{m.end}</span>
                  <Segmented
                    label={m.endLabel}
                    value={effectiveEnd}
                    onChange={setEndMode}
                    options={[
                      ...(mode === "scheduled" ? [{ v: "reveal" as const, t: m.endAtReveal }] : []),
                      { v: "scheduled", t: m.pickTime },
                      { v: "none", t: m.endNone },
                    ]}
                  />
                </div>
                {effectiveEnd === "scheduled" && (
                  <div className="group-row h-[50px]">
                    <label htmlFor="shoot-end" className="shrink-0 text-label-2">
                      {m.endAt}
                    </label>
                    <input
                      id="shoot-end"
                      type="datetime-local"
                      value={endLocal}
                      onChange={(e) => setEndLocal(e.target.value)}
                      className="min-w-0 bg-transparent text-right text-base text-label-2 outline-none [color-scheme:dark]"
                    />
                  </div>
                )}
              </div>
            </div>
          </Section>

          {error && <p className="px-4 text-sm text-danger">{error}</p>}

          <div className="space-y-3">
            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting && <Loader2 className="size-5 animate-spin" />}
              {m.submit}
            </button>
            <p className="text-center text-xs text-label-3">{m.ownerNote}</p>
          </div>
        </form>
      </div>
    </main>
  );
}

function Section({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-4 text-[13px] text-label-2">{label}</h2>
      {children}
      {hint && <p className="mt-2 px-4 text-[13px] leading-relaxed text-label-2">{hint}</p>}
    </section>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { v: T; t: string }[];
}) {
  return (
    <div className="flex gap-0.5 rounded-[9px] bg-bg/60 p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={`h-8 rounded-[7px] px-3 text-[13px] font-semibold whitespace-nowrap transition ${
            value === o.v ? "bg-surface-2 text-label shadow-[0_1px_3px_rgb(0_0_0/0.4)]" : "text-label-2"
          }`}
        >
          {o.t}
        </button>
      ))}
    </div>
  );
}
