"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  /** ISO 8601 の現像日時 */
  target: string;
  /** 0 になった瞬間に一度だけ呼ばれる */
  onComplete?: () => void;
  /** large：大きなシステム書体の数字 / lcd：オレンジの長体数字 */
  tone?: "large" | "lcd";
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
export function CountdownTimer({ target, onComplete, tone = "large" }: Props) {
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

  const isLcd = tone === "lcd";
  const big = units.length > 3 ? "text-[46px]" : isLcd ? "text-[56px]" : "text-[64px]";

  return (
    <div className="flex items-baseline justify-between gap-3" role="timer" aria-live="off">
      {units.map((u) => (
        <div key={u.label} className="flex items-baseline gap-1">
          <span
            className={
              isLcd
                ? `cond ${big} leading-none tabular-nums text-accent`
                : `${big} leading-none font-semibold tracking-[-0.03em] tabular-nums`
            }
          >
            {u.value}
          </span>
          <span className="text-[15px] text-label-2">{u.label}</span>
        </div>
      ))}
    </div>
  );
}
