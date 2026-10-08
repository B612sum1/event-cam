import Link from "next/link";
import { CameraIllustration } from "@/components/CameraIllustration";
import { Wordmark } from "@/components/Carton";
import { MyEvents } from "@/components/MyEvents";

const STEPS = [
  {
    title: "QRコードを置く",
    body: "イベントを作ると、参加用のQRコードができます。印刷してテーブルへ。",
  },
  {
    title: "ゲストが撮る",
    body: "アプリはいりません。読み取ったスマホが、枚数の決まった使い捨てカメラに。",
  },
  {
    title: "決めた時間に現像",
    body: "その時間まで、誰も写真を見られません。お開きのあとに、みんなで見返せます。",
  },
];

export default function Home() {
  return (
    <main className="safe-top safe-bottom flex min-h-dvh flex-1 flex-col bg-bg">
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-5 pt-12 text-center">
        <Wordmark />
        <CameraIllustration className="mt-12" />
        <h1 className="mt-14 text-[clamp(34px,10vw,64px)] leading-[1.12] font-bold tracking-[-0.03em]">
          配って、撮って、
          <br />
          あとで現像。
        </h1>
        <p className="mt-4 max-w-md text-[17px] leading-relaxed text-label-2">
          結婚式やパーティーで、ゲストのスマホを使い捨てカメラに。撮った写真は、決めた時間にまとめて届きます。
        </p>
        <Link href="/admin/create" className="btn-primary mt-9 w-full max-w-xs">
          イベントを作る
        </Link>
        <p className="mt-3 text-xs text-label-3">無料。登録はいりません。</p>
        <MyEvents />
      </section>

      <section className="mx-auto mt-20 w-full max-w-3xl px-5">
        <h2 className="text-[22px] font-bold tracking-[-0.01em]">使いかた</h2>
        <ol className="group-list mt-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="group-row items-start py-4">
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
