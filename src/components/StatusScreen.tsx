import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  kind?: "loading" | "message";
  title?: string;
  children?: ReactNode;
  action?: { href: string; label: string };
  dark?: boolean;
};

/** 読み込み中・エラー・見つからない等の全画面表示 */
export function StatusScreen({ kind = "message", title, children, action, dark }: Props) {
  return (
    <main
      className={`flex flex-1 min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center ${
        dark ? "bg-body text-white/85" : "paper-grain"
      }`}
    >
      {kind === "loading" ? (
        <Loader2 className="size-7 animate-spin opacity-60" aria-label="読み込み中" />
      ) : (
        <>
          {title && <h1 className="font-serif text-xl tracking-wide">{title}</h1>}
          {children && (
            <div className={`max-w-sm text-sm leading-relaxed ${dark ? "text-white/60" : "text-muted"}`}>
              {children}
            </div>
          )}
          {action && (
            <Link
              href={action.href}
              className="mt-2 rounded-full bg-accent px-6 py-3 text-sm font-medium text-accent-ink"
            >
              {action.label}
            </Link>
          )}
        </>
      )}
    </main>
  );
}
