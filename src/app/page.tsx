"use client";

import Link from "next/link";
import { CameraIllustration } from "@/components/CameraIllustration";
import { Wordmark } from "@/components/Carton";
import { LanguageToggle } from "@/components/LanguageToggle";
import { MyEvents } from "@/components/MyEvents";
import { useI18n } from "@/lib/i18n";

export default function Home() {
  const { t } = useI18n();
  const h = t.home;
  return (
    <main className="safe-top safe-bottom flex min-h-dvh flex-1 flex-col bg-bg">
      <div className="mx-auto flex w-full max-w-3xl justify-end px-5 pt-3">
        <LanguageToggle />
      </div>
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-5 pt-5 text-center">
        <Wordmark />
        <CameraIllustration className="mt-12" />
        <h1 className="mt-14 text-[clamp(34px,10vw,64px)] leading-[1.12] font-bold tracking-[-0.03em]">
          {h.title1}
          <br />
          {h.title2}
        </h1>
        <p className="mt-4 max-w-md text-[17px] leading-relaxed text-label-2">{h.lead}</p>
        <Link href="/admin/create" className="btn-primary mt-9 w-full max-w-xs">
          {h.create}
        </Link>
        <p className="mt-3 text-xs text-label-3">{h.free}</p>
        <MyEvents />
      </section>

      <section className="mx-auto mt-20 w-full max-w-3xl px-5">
        <h2 className="text-[22px] font-bold tracking-[-0.01em]">{h.howTo}</h2>
        <ol className="group-list mt-4">
          {h.steps.map((s, i) => (
            <li key={i} className="group-row items-start py-4">
              <span className="cond mt-0.5 w-6 shrink-0 text-xl text-accent">{i + 1}</span>
              <div className="flex-1">
                <h3 className="text-base font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-label-2">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
