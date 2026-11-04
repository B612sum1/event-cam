"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { abortPhotoUploads, getSupabaseBrowserClient } from "@/lib/supabase/client";
import { addPending, listPending, removePending, sendShot, type PendingShot } from "@/lib/utils/uploadQueue";

type Callbacks = {
  /** 写真が保存できた。late = いったん送れずに残っていた写真 */
  onSent?: (shot: PendingShot, late: boolean) => void;
  /** 上限・撮影時間の終了などで、送り直しても保存できない写真があった */
  onRejected?: (shot: PendingShot, error: unknown) => void;
  /** 送れなかった（写真はスマホに残る）。manual = 「送り直す」を押したときの失敗 */
  onFailed?: (error: unknown, manual: boolean) => void;
};

/**
 * 未送信の写真を管理する。
 * 撮った写真は enqueue でスマホに保存してから、その場で1回だけ送る。
 * 送れなかった写真はスマホに残り、「送り直す」（resend）を押したときに送る。自動では送り直さない。
 */
export function usePendingUploads(guestId: string | null, callbacks: Callbacks = {}) {
  const [pending, setPending] = useState(0);
  const [sending, setSending] = useState(false);
  /** 最後に送れなかった理由（画面に出して、原因を確かめられるようにする） */
  const [lastError, setLastError] = useState<unknown>(null);
  const cbRef = useRef(callbacks);
  useEffect(() => {
    cbRef.current = callbacks;
  });

  const busy = useRef(false);
  const again = useRef(false);
  const manualRef = useRef(false);
  const failedOnce = useRef(new Set<string>());

  const flush = useCallback(async () => {
    if (!guestId) return;
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    setSending(true);
    try {
      do {
        again.current = false;
        const manual = manualRef.current;
        manualRef.current = false;
        const supabase = getSupabaseBrowserClient();
        for (const shot of await listPending(guestId)) {
          const result = await sendShot(supabase, shot);
          if (result.kind === "retry") {
            failedOnce.current.add(shot.id);
            setLastError(result.error);
            cbRef.current.onFailed?.(result.error, manual);
            break; // 電波が無いうちは、後ろの写真も送れないので一旦やめる
          }
          await removePending(shot.id);
          setPending((n) => Math.max(0, n - 1));
          const late = failedOnce.current.delete(shot.id);
          if (result.kind === "sent") cbRef.current.onSent?.(shot, late);
          else cbRef.current.onRejected?.(shot, result.error);
        }
      } while (again.current);
      const left = (await listPending(guestId)).length;
      setPending(left);
      if (left === 0) setLastError(null);
    } finally {
      busy.current = false;
      setSending(false);
    }
  }, [guestId]);

  /** 撮った写真をスマホに保存して、その場で1回送ってみる */
  const enqueue = useCallback(
    async (shot: PendingShot) => {
      await addPending(shot);
      setPending((n) => n + 1);
      void flush();
    },
    [flush],
  );

  /** 「送り直す」：止まったままの通信があれば打ち切ってから、残っている写真を全部送る */
  const resend = useCallback(() => {
    manualRef.current = true;
    if (busy.current) {
      again.current = true;
      abortPhotoUploads();
    } else {
      void flush();
    }
  }, [flush]);

  // 開いたとき：前回送れずに残っている写真の枚数だけ数える（送るのはボタンを押したとき）
  useEffect(() => {
    if (!guestId) return;
    let cancelled = false;
    void listPending(guestId).then((list) => {
      if (!cancelled) setPending(list.length);
    });
    return () => {
      cancelled = true;
    };
  }, [guestId]);

  return { pending, sending, lastError, enqueue, resend };
}
