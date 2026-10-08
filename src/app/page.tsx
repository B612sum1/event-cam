import Link from "next/link";
import { ArrowRight, Camera, QrCode, Sparkles } from "lucide-react";
import { MyEvents } from "@/components/MyEvents";

const STEPS = [
  {
    icon: QrCode,
    title: "QRコードを置く",
    body: "イベントを作ると参加用QRコードが発行されます。印刷してテーブルへ。",
  },
  {
    icon: Camera,
    title: "ゲストが撮る",
    body: "アプリ不要。読み取ったスマホがそのまま、枚数限定のインスタントカメラに。",
  },
  {
    icon: Sparkles,
    title: "あとで一斉に現像",
    body: "指定した時刻になるまで、誰も写真を見られません。お開きのあとのお楽しみ。",
  },
];

export default function Home() {
  return (
    <main className="paper-grain flex min-h-dvh flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-16 sm:py-24">
        <p className="text-xs tracking-[0.35em] text-gold">EVENT CAM</p>
        <h1 className="mt-5 font-serif text-[40px] leading-[1.25] tracking-wide text-balance sm:text-6xl">
          みんなで撮って、
          <br />
          あとで現像。
        </h1>
        <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted">
          結婚式やパーティーのゲストのスマホが、今日だけの共有インスタントカメラに。
          撮った写真は、決めた時刻にまとめて公開されます。
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            href="/admin/create"
            className="inline-flex items-center gap-2 rounded-full bg-accent px-7 py-4 text-[15px] font-medium text-accent-ink shadow-sm transition active:scale-[0.98]"
          >
            イベントを作成する <ArrowRight className="size-4" />
          </Link>
          <span className="text-xs text-muted">無料・登録不要</span>
        </div>

        <MyEvents />
      </section>

      <section className="border-t border-line bg-paper-2/50">
        <ol className="mx-auto grid max-w-5xl gap-8 px-6 py-14 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <div className="flex items-center gap-3">
                <span className="font-serif text-sm text-gold">0{i + 1}</span>
                <s.icon className="size-5 text-ink/70" strokeWidth={1.6} />
              </div>
              <h2 className="mt-3 font-serif text-lg">{s.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
