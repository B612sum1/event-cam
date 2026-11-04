"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { addPending, listPending, removePending, sendShot, type PendingShot } from "@/lib/utils/uploadQueue";

type Callbacks = {
  /** 写真が保存できた。late = いったん送れずに待っていた写真 */
  onSent?: (shot: PendingShot, late: boolean) => void;
  /** 上限・撮影時間の終了などで、送り直しても保存できない写真があった */
  onRejected?: (shot: PendingShot, error: unknown) => void;
  /** 電波が悪く、あとで送り直すことになった */
  onWaiting?: (shot: PendingShot) => void;
};

/** 電波が戻るのを待つ間、この間隔でも送り直してみる */
const RETRY_EVERY = 20_000;

/**
 * 未送信の写真を管理する。撮った写真は enqueue で箱に入れ、すぐ送る。
 * 送れなかったら、電波が戻ったとき・画面に戻ってきたとき・一定時間ごとに送り直す。
 */
export function usePendingUploads(guestId: string | null, callbacks: Callbacks = {}) {
  const [pending, setPending] = useState(0);
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const cbRef = useRef(callbacks);
  useEffect(() => {
    cbRef.current = callbacks;
  });

  const busy = useRef(false);
  const again = useRef(false);
  /** 一度送れなかった写真（あとで届いたときに「未送信だった写真を送りました」と出すため） */
  const failedOnce = useRef(new Set<string>());

  const refreshCount = useCallback(async () => {
    if (!guestId) return 0;
    const list = await listPending(guestId);
    setPending(list.length);
    return list.length;
  }, [guestId]);

  const flush = useCallback(async () => {
    if (!guestId) return;
    // 送信中に呼ばれたら、終わったあとにもう一周する
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    setSending(true);
    try {
      do {
        again.current = false;
        const supabase = getSupabaseBrowserClient();
        for (const shot of await listPending(guestId)) {
          const result = await sendShot(supabase, shot);
          if (result.kind === "retry") {
            failedOnce.current.add(shot.id);
            setWaiting(true);
            cbRef.current.onWaiting?.(shot);
            // 電波が無いうちは、後ろの写真も送れないので一旦やめる
            again.current = false;
            break;
          }
          await removePending(shot.id);
          setPending((n) => Math.max(0, n - 1));
          const late = failedOnce.current.delete(shot.id);
          if (result.kind === "sent") cbRef.current.onSent?.(shot, late);
          else cbRef.current.onRejected?.(shot, result.error);
        }
      } while (again.current);
      const left = await refreshCount();
      if (left === 0) setWaiting(false);
    } finally {
      busy.current = false;
      setSending(false);
    }
  }, [guestId, refreshCount]);

  /** 撮った写真を箱に入れて、すぐ送る */
  const enqueue = useCallback(
    async (shot: PendingShot) => {
      await addPending(shot);
      setPending((n) => n + 1);
      void flush();
    },
    [flush],
  );

  // 開いたとき：前回送れずに残っている写真があれば送る
  useEffect(() => {
    if (!guestId) return;
    let cancelled = false;
    void listPending(guestId).then((list) => {
      if (cancelled) return;
      setPending(list.length);
      if (list.length > 0) void flush();
    });
    return () => {
      cancelled = true;
    };
  }, [guestId, flush]);

  // 電波が戻ったとき・画面に戻ってきたとき・一定時間ごとに送り直す
  useEffect(() => {
    if (!guestId || pending === 0) return;
    const kick = () => void flush();
    const onVisible = () => document.visibilityState === "visible" && kick();
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(kick, RETRY_EVERY);
    return () => {
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(id);
    };
  }, [guestId, pending, flush]);

  return { pending, sending, waiting, enqueue, flush };
}
