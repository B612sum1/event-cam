"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, Camera, Loader2 } from "lucide-react";
import { StatusScreen } from "@/components/StatusScreen";
import { useEventGuest } from "@/lib/hooks/useEventGuest";
import { ensureAnonymousUser, getSupabaseBrowserClient } from "@/lib/supabase/client";
import { saveStoredGuest } from "@/lib/utils/guestStorage";
import { formatDateTime, isRevealed, toFriendlyError } from "@/lib/utils/format";

export default function JoinPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const router = useRouter();
  const { state } = useEventGuest(eventId);

  const [nickname, setNickname] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status === "loading") return <StatusScreen kind="loading" />;
  if (state.status === "not-found")
    return (
      <StatusScreen title="イベントが見つかりません">
        QRコードやURLが正しいか、主催者にご確認ください。
      </StatusScreen>
    );
  if (state.status === "error") return <StatusScreen title="読み込みに失敗しました">{state.message}</StatusScreen>;

  const { event } = state;
  const existing = state.status === "ready" ? state.guest : null;
  const value = nickname ?? existing?.nickname ?? "";

  const join = async (e: FormEvent) => {
    e.preventDefault();
    const name = value.trim();
    if (!name) {
      setError("ニックネームを入力してください");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const user = await ensureAnonymousUser(supabase);

      // 同じ端末で再参加した場合はニックネームだけ更新（unique(event_id, auth_uid)）
      const { data: guest, error: upsertError } = await supabase
        .from("guests")
        .upsert(
          { event_id: event.id, auth_uid: user.id, nickname: name },
          { onConflict: "event_id,auth_uid" },
        )
        .select()
        .single();
      if (upsertError) throw upsertError;

      saveStoredGuest({ guest_id: guest.id, event_id: event.id, nickname: guest.nickname });
      router.replace(`/event/${event.id}/camera`);
    } catch (err) {
      setError(toFriendlyError(err));
      setSubmitting(false);
    }
  };

  return (
    <main className="paper-grain flex min-h-dvh flex-1 flex-col items-center px-6 py-12">
      <div className="flex w-full max-w-sm flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-body text-[#f6f0e6] shadow-lg">
            <Camera className="size-7" strokeWidth={1.6} />
          </span>
          <p className="mt-8 text-xs tracking-[0.3em] text-gold">WELCOME</p>
          <h1 className="mt-3 font-serif text-[28px] leading-snug tracking-wide text-balance">{event.title}</h1>
          <div className="mt-6 h-px w-12 bg-line" />
          <p className="mt-6 text-sm leading-relaxed text-muted">
            <span className="inline-block">あなたのスマホが、</span>
            <span className="inline-block">今日だけのインスタントカメラに。</span>
            <br />
            ひとり<strong className="font-semibold text-ink">{event.max_photos_per_guest}枚</strong>まで撮影できます。
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {event.reveal_at && !isRevealed(event.reveal_at)
              ? `写真は ${formatDateTime(event.reveal_at)} に一斉に現像されます。`
              : "撮った写真はすぐにギャラリーで共有されます。"}
          </p>
        </div>

        <form onSubmit={join} className="mt-10 w-full">
          <label htmlFor="nickname" className="mb-2 block text-xs tracking-wider text-muted">
            ニックネーム（写真に表示されます）
          </label>
          <input
            id="nickname"
            value={value}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={30}
            autoComplete="nickname"
            enterKeyHint="go"
            placeholder="例：新郎友人 たろう"
            className="w-full rounded-xl border border-line bg-card px-4 py-3.5 text-base outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 py-4 text-base font-medium text-accent-ink shadow-sm transition active:scale-[0.99] disabled:opacity-60"
          >
            {submitting ? <Loader2 className="size-5 animate-spin" /> : null}
            {existing ? "カメラに戻る" : "参加する"}
            {!submitting && <ArrowRight className="size-4" />}
          </button>
          <p className="mt-4 text-center text-[11px] leading-relaxed text-muted">
            <span className="inline-block">会員登録は不要です。</span><span className="inline-block">参加情報はこの端末のブラウザに保存されます。</span>
          </p>
        </form>
      </div>
    </main>
  );
}
