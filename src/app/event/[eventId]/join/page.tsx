"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { CameraIllustration } from "@/components/CameraIllustration";
import { Wordmark } from "@/components/Carton";
import { LanguageToggle } from "@/components/LanguageToggle";
import { StatusScreen } from "@/components/StatusScreen";
import { useI18n } from "@/lib/i18n";
import { useEventGuest } from "@/lib/hooks/useEventGuest";
import { ensureAnonymousUser, getSupabaseBrowserClient } from "@/lib/supabase/client";
import { saveStoredGuest } from "@/lib/utils/guestStorage";
import { formatDateTime, formatShootWindow, getShootingState, isRevealed, toFriendlyError } from "@/lib/utils/format";

export default function JoinPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const router = useRouter();
  const { state } = useEventGuest(eventId);
  const { t, lang } = useI18n();
  const j = t.join;

  const [nickname, setNickname] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 同じ名前の人がいると知らせた名前（もう一度押せばそのまま参加できる）
  const [duplicateName, setDuplicateName] = useState<string | null>(null);

  if (state.status === "loading") return <StatusScreen kind="loading" />;
  if (state.status === "not-found")
    return (
      <StatusScreen title={t.common.eventNotFound}>{t.common.eventNotFoundBody}</StatusScreen>
    );
  if (state.status === "error") return <StatusScreen title={t.common.loadFailed}>{state.message}</StatusScreen>;

  const { event } = state;
  const existing = state.status === "ready" ? state.guest : null;
  const value = nickname ?? existing?.nickname ?? "";

  const join = async (e: FormEvent) => {
    e.preventDefault();
    const name = value.trim();
    if (!name) {
      setError(j.nameRequired);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const user = await ensureAnonymousUser(supabase);

      // 同じイベントに同じ名前の人がいたら、一度だけ知らせる（止めはしない）
      const unchanged = existing && existing.nickname === name;
      if (!unchanged && duplicateName !== name) {
        const { data: taken, error: checkError } = await supabase.rpc("is_nickname_taken", {
          p_event_id: event.id,
          p_nickname: name,
        });
        // 確認用の関数がまだ無い（004 未実行）などのときは、確認せずに参加させる
        if (!checkError && taken) {
          setDuplicateName(name);
          setSubmitting(false);
          return;
        }
      }

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
      // 撮影時間が終わっていたら、カメラではなくギャラリーへ
      router.replace(`/event/${event.id}/${getShootingState(event) === "closed" ? "gallery" : "camera"}`);
    } catch (err) {
      setError(toFriendlyError(err, lang));
      setSubmitting(false);
    }
  };

  const revealPending = event.reveal_at && !isRevealed(event.reveal_at);
  const closed = getShootingState(event) === "closed";
  const isDuplicate = duplicateName !== null && duplicateName === value.trim();

  return (
    <main className="safe-top safe-bottom mx-auto flex min-h-dvh w-full max-w-md flex-1 flex-col items-center px-5">
      <div className="mt-3 flex w-full justify-end">
        <LanguageToggle />
      </div>
      <Wordmark className="mt-3" />
      <CameraIllustration className="mt-10" shots={event.max_photos_per_guest} />

      <h1 className="mt-12 text-center text-[32px] leading-tight font-bold tracking-[-0.02em]">{j.headline}</h1>
      <p className="mt-2.5 text-center text-[15px] leading-relaxed text-label-2 text-balance">
        {j.lead(event.title)}
      </p>

      <div className="group-list mt-8 w-full">
        <div className="group-row">
          <span>{j.shots}</span>
          <span className="text-label-2">{t.common.shotsUnit(event.max_photos_per_guest)}</span>
        </div>
        <div className="group-row">
          <span className="shrink-0">{j.window}</span>
          <span className={`text-right ${closed ? "text-danger" : "text-label-2"}`}>
            {closed ? j.windowClosed : formatShootWindow(event.shoot_start_at, event.shoot_end_at, lang)}
          </span>
        </div>
        <div className="group-row">
          <span>{j.reveal}</span>
          <span className="text-label-2">{revealPending ? formatDateTime(event.reveal_at!, lang) : j.revealNow}</span>
        </div>
      </div>
      <p className="mt-2 w-full px-4 text-[13px] leading-relaxed text-label-2">
        {revealPending
          ? j.noteHidden
          : j.noteInstant}
      </p>

      <div className="min-h-8 flex-1" />

      <form onSubmit={join} className="flex w-full flex-col gap-3 pt-6">
        <div className="group-list">
          <div className="group-row h-[50px]">
            <label htmlFor="nickname" className="shrink-0">
              {j.name}
            </label>
            <input
              id="nickname"
              value={value}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={30}
              autoComplete="nickname"
              enterKeyHint="go"
              placeholder={j.namePlaceholder}
              className="min-w-0 flex-1 bg-transparent text-right text-base outline-none"
            />
          </div>
        </div>
        {error && <p className="px-4 text-sm text-danger">{error}</p>}
        {isDuplicate && (
          <div role="status" className="rounded-xl bg-accent/12 px-4 py-3 text-[13px] leading-relaxed text-accent">
            {j.duplicate(value.trim())}
            <span className="text-label-2">{j.duplicateHint}</span>
          </div>
        )}
        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting && <Loader2 className="size-5 animate-spin" />}
          {isDuplicate ? j.joinAnyway : closed ? j.toGallery : existing ? j.backToCamera : j.getCamera}
        </button>
        <p className="text-center text-xs text-label-3">{j.noSignup}</p>
      </form>
    </main>
  );
}
