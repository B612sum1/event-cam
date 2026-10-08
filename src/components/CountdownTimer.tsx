"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  /** ISO 8601 の現像日時 */
  target: string;
  /** 0 になった瞬間に一度だけ呼ばれる */
  onComplete?: () => void;
  tone?: "paper" | "dark";
};

type Parts = { days: number; hours: number; minutes: number; seconds: number };

function diffParts(ms: number): Parts {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 現像までのカウントダウン（サーバー描画時は「--」を出してハイドレーションずれを防ぐ） */
export function CountdownTimer({ target, onComplete, tone = "paper" }: Props) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    completedRef.current = false;
    const targetMs = new Date(target).getTime();
    const tick = () => {
      const ms = targetMs - Date.now();
      setRemaining(ms);
      if (ms <= 0 && !completedRef.current) {
        completedRef.current = true;
        onCompleteRef.current?.();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [target]);

  const parts = remaining === null ? null : diffParts(remaining);
  const units: { label: string; value: string }[] = parts
    ? [
        ...(parts.days > 0 ? [{ label: "日", value: String(parts.days) }] : []),
        { label: "時間", value: pad(parts.hours) },
        { label: "分", value: pad(parts.minutes) },
        { label: "秒", value: pad(parts.seconds) },
      ]
    : [
        { label: "時間", value: "--" },
        { label: "分", value: "--" },
        { label: "秒", value: "--" },
      ];

  const sub = tone === "dark" ? "text-white/50" : "text-muted";

  return (
    <div className="flex items-end justify-center gap-3 sm:gap-5" role="timer" aria-live="off">
      {units.map((u, i) => (
        <div key={u.label} className="flex items-end gap-3 sm:gap-5">
          {i > 0 && <span className={`pb-6 font-serif text-2xl ${sub}`}>:</span>}
          <div className="flex flex-col items-center">
            <span className="font-serif text-5xl tabular-nums leading-none tracking-tight sm:text-6xl">
              {u.value}
            </span>
            <span className={`mt-2 text-[11px] tracking-[0.2em] ${sub}`}>{u.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
