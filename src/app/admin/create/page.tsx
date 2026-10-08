"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { ensureAnonymousUser, getSupabaseBrowserClient } from "@/lib/supabase/client";
import { toDateTimeLocalValue, toFriendlyError } from "@/lib/utils/format";

const PHOTO_PRESETS = [10, 15, 24, 27];

type RevealMode = "scheduled" | "immediate";

function quickTimes(): { label: string; value: string }[] {
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
    { label: "3時間後", value: toDateTimeLocalValue(inHours(3)) },
    { label: "5時間後", value: toDateTimeLocalValue(inHours(5)) },
    { label: "明日の朝9時", value: toDateTimeLocalValue(tomorrow9) },
  ];
}

export default function CreateEventPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [maxPhotos, setMaxPhotos] = useState(15);
  const [mode, setMode] = useState<RevealMode>("scheduled");
  const [revealLocal, setRevealLocal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = title.trim();
    if (!trimmed) return setError("イベント名を入力してください");
    if (!Number.isInteger(maxPhotos) || maxPhotos < 1 || maxPhotos > 100)
      return setError("撮影枚数は 1〜100 枚で指定してください");

    let revealAt: string | null = null;
    if (mode === "scheduled") {
      if (!revealLocal) return setError("現像日時を指定してください");
      const d = new Date(revealLocal); // datetime-local は端末のタイムゾーンとして解釈される
      if (Number.isNaN(d.getTime())) return setError("現像日時が正しくありません");
      if (d.getTime() <= Date.now()) return setError("現像日時は未来の時刻を指定してください");
      revealAt = d.toISOString();
    }

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
          owner_uid: user.id,
        })
        .select("id")
        .single();
      if (insertError) throw insertError;
      router.push(`/admin/events/${data.id}`);
    } catch (err) {
      setError(toFriendlyError(err));
      setSubmitting(false);
    }
  };

  return (
    <main className="paper-grain flex min-h-dvh flex-1 flex-col px-5 py-8">
      <div className="mx-auto w-full max-w-lg">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted">
          <ArrowLeft className="size-4" /> トップ
        </Link>

        <p className="mt-8 text-xs tracking-[0.3em] text-gold">NEW EVENT</p>
        <h1 className="mt-2 font-serif text-3xl tracking-wide">イベントを作成</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          作成すると参加用のQRコードが発行されます。テーブルに置いたり、招待状に印刷してご利用ください。
        </p>

        <form onSubmit={submit} className="mt-10 space-y-8">
          <Field label="イベント名" htmlFor="title">
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              required
              placeholder="例：Taro & Hanako Wedding"
              className="input"
            />
          </Field>

          <Field label="1人あたりの撮影枚数" htmlFor="max" hint="使い捨てカメラは27枚。少ないほど一枚一枚が特別になります。">
            <div className="flex flex-wrap items-center gap-2">
              {PHOTO_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMaxPhotos(n)}
                  className={`rounded-full px-4 py-2 text-sm ring-1 transition ${
                    maxPhotos === n ? "bg-body text-white ring-body" : "bg-card ring-line"
                  }`}
                >
                  {n}枚
                </button>
              ))}
              <div className="flex items-center gap-2">
                <input
                  id="max"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  value={Number.isNaN(maxPhotos) ? "" : maxPhotos}
                  onChange={(e) => setMaxPhotos(e.target.valueAsNumber)}
                  className="input w-24 text-center"
                />
                <span className="text-sm text-muted">枚</span>
              </div>
            </div>
          </Field>

          <Field label="現像（一斉公開）のタイミング">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { v: "scheduled", t: "日時を指定", d: "その時刻まで誰も見られない" },
                  { v: "immediate", t: "すぐ公開", d: "撮った瞬間にギャラリーへ" },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setMode(o.v)}
                  className={`rounded-2xl px-4 py-3 text-left ring-1 transition ${
                    mode === o.v ? "bg-card ring-2 ring-accent" : "bg-card/60 ring-line"
                  }`}
                >
                  <span className="block text-sm font-medium">{o.t}</span>
                  <span className="mt-0.5 block text-xs text-muted">{o.d}</span>
                </button>
              ))}
            </div>

            {mode === "scheduled" && (
              <div className="mt-4 space-y-3">
                <input
                  type="datetime-local"
                  value={revealLocal}
                  onChange={(e) => setRevealLocal(e.target.value)}
                  className="input"
                  aria-label="現像日時"
                />
                <div className="flex flex-wrap gap-2">
                  {quickTimes().map((q) => (
                    <button
                      key={q.label}
                      type="button"
                      onClick={() => setRevealLocal(q.value)}
                      className="rounded-full bg-paper-2 px-3 py-1.5 text-xs text-ink/80"
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Field>

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 py-4 font-medium text-accent-ink shadow-sm disabled:opacity-60"
          >
            {submitting && <Loader2 className="size-5 animate-spin" />}
            イベントを作成してQRコードを発行
          </button>
          <p className="text-center text-[11px] leading-relaxed text-muted">
            管理画面は、作成に使ったこのブラウザからのみ開けます。
          </p>
        </form>
      </div>
    </main>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-2 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="mt-2 text-xs text-muted">{hint}</p>}
    </div>
  );
}
