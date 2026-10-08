import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  kind?: "loading" | "message";
  title?: string;
  children?: ReactNode;
  action?: { href: string; label: string };
};

/** 読み込み中・エラー・見つからない等の全画面表示 */
export function StatusScreen({ kind = "message", title, children, action }: Props) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-3 bg-bg px-8 text-center">
      {kind === "loading" ? (
        <Loader2 className="size-7 animate-spin text-label-3" aria-label="読み込み中" />
      ) : (
        <>
          {title && <h1 className="text-[22px] font-bold tracking-[-0.01em]">{title}</h1>}
          {children && <div className="max-w-sm text-[15px] leading-relaxed text-label-2">{children}</div>}
          {action && (
            <Link href={action.href} className="btn-primary mt-4">
              {action.label}
            </Link>
          )}
        </>
      )}
    </main>
  );
}
