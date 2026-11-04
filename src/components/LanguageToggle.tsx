"use client";

import { useI18n, type Lang } from "@/lib/i18n";

const OPTIONS: { v: Lang; label: string }[] = [
  { v: "ja", label: "日本語" },
  { v: "en", label: "EN" },
];

/** 日本語 ／ English の切り替え（どの画面で切り替えても、この端末では全画面に反映される） */
export function LanguageToggle({ className = "" }: { className?: string }) {
  const { lang, t, setLang } = useI18n();
  return (
    <div
      role="radiogroup"
      aria-label={t.common.language}
      className={`flex h-8 shrink-0 gap-0.5 rounded-full bg-white/[0.12] p-0.5 print:hidden ${className}`}
    >
      {OPTIONS.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={lang === o.v}
          lang={o.v}
          onClick={() => setLang(o.v)}
          className={`rounded-full px-2.5 text-xs font-semibold transition ${
            lang === o.v ? "bg-label text-black" : "text-label-2"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
