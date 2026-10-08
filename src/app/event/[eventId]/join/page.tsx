"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { CameraIllustration } from "@/components/CameraIllustration";
import { Wordmark } from "@/components/Carton";
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

  const revealPending = event.reveal_at && !isRevealed(event.reveal_at);

  return (
    <main className="safe-top safe-bottom mx-auto flex min-h-dvh w-full max-w-md flex-1 flex-col items-center px-5">
      <Wordmark className="mt-10" />
      <CameraIllustration className="mt-10" shots={event.max_photos_per_guest} />

      <h1 className="mt-12 text-center text-[32px] leading-tight font-bold tracking-[-0.02em]">撮って、待って、現像。</h1>
      <p className="mt-2.5 text-center text-[15px] leading-relaxed text-label-2 text-balance">
        {event.title} の、今日だけのカメラ。
      </p>

      <div className="group-list mt-8 w-full">
        <div className="group-row">
          <span>撮れる枚数</span>
          <span className="text-label-2">{event.max_photos_per_guest}枚</span>
        </div>
        <div className="group-row">
          <span>現像</span>
          <span className="text-label-2">{revealPending ? formatDateTime(event.reveal_at!) : "撮ってすぐ"}</span>
        </div>
      </div>
      <p className="mt-2 w-full px-4 text-[13px] leading-relaxed text-label-2">
        {revealPending
          ? "現像まで、誰も写真を見られません。撮った本人も。"
          : "撮った写真は、すぐにみんなのギャラリーに並びます。"}
      </p>

      <div className="min-h-8 flex-1" />

      <form onSubmit={join} className="flex w-full flex-col gap-3 pt-6">
        <div className="group-list">
          <div className="group-row h-[50px]">
            <label htmlFor="nickname" className="shrink-0">
              おなまえ
            </label>
            <input
              id="nickname"
              value={value}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={30}
              autoComplete="nickname"
              enterKeyHint="go"
              placeholder="新郎友人 たろう"
              className="min-w-0 flex-1 bg-transparent text-right text-base outline-none"
            />
          </div>
        </div>
        {error && <p className="px-4 text-sm text-danger">{error}</p>}
        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting && <Loader2 className="size-5 animate-spin" />}
          {existing ? "カメラに戻る" : "カメラを受け取る"}
        </button>
        <p className="text-center text-xs text-label-3">登録はいりません。このブラウザに保存されます。</p>
      </form>
    </main>
  );
}
