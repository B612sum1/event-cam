import { CartonStripes, Wordmark } from "./Carton";

type Props = {
  className?: string;
  /** 外箱に印刷する「◯枚撮り」 */
  shots?: number;
  /** 黒背景の上で使うときは後ろにスポットライトを当てる */
  spotlight?: boolean;
};

/** 使い捨てカメラの製品写真（CSS だけで描画） */
export function CameraIllustration({ className = "", shots = 27, spotlight = true }: Props) {
  return (
    <div className={`relative aspect-[290/170] w-full max-w-[290px] ${className}`} aria-hidden>
      {spotlight && (
        <div className="pointer-events-none absolute -inset-x-16 -inset-y-20 bg-[radial-gradient(50%_45%_at_50%_55%,rgb(255_255_255/0.11),transparent_70%)]" />
      )}
      <div className="absolute inset-0 -rotate-[4deg]">
        {/* シャッターボタン */}
        <span className="absolute -top-[5%] right-[17%] h-[7.5%] w-[12%] rounded-t-md bg-[linear-gradient(#edebe6,#a19e96)]" />
        {/* ボディ */}
        <div className="absolute inset-0 overflow-hidden rounded-[22px] bg-[linear-gradient(#2e2c29,#1a1917)] shadow-[0_34px_44px_-20px_rgb(0_0_0/0.9),0_0_0_1px_rgb(255_255_255/0.06),inset_0_1px_0_rgb(255_255_255/0.18)]">
          {/* ファインダー窓 */}
          <span className="absolute top-[9%] left-[7.5%] h-[16.5%] w-[15%] rounded-md bg-[linear-gradient(135deg,#5a6b74,#0f1416_62%)] shadow-[inset_0_0_0_2px_#000]" />
          {/* フラッシュ */}
          <span className="absolute top-[7.5%] right-[6%] h-[21%] w-[27%] rounded-md bg-[repeating-linear-gradient(90deg,#f6f4ef_0_3px,#cbc8c0_3px_6px)] shadow-[inset_0_0_0_2px_#3a3733]" />
          {/* 外箱の紙 */}
          <div className="carton absolute inset-x-0 top-[36.5%] bottom-[8%] flex flex-col justify-between">
            <div className="flex flex-col items-end gap-0.5 self-end pt-[3.5%] pr-[5.5%]">
              <span className="text-[11px] font-bold">{shots}枚撮り</span>
              <Wordmark size="xs" tone="light" />
            </div>
            <CartonStripes />
          </div>
          {/* レンズ */}
          <span className="absolute top-[22%] left-[30%] aspect-square w-[34.5%] rounded-full bg-[radial-gradient(circle,#2c3a40_0_18%,#050606_22%_46%,#3a3733_50%_58%,#141312_62%_100%)] shadow-[0_6px_12px_rgb(0_0_0/0.5),inset_0_1px_0_rgb(255_255_255/0.22)]">
            <span className="absolute top-[30%] left-[34%] size-[10%] rounded-full bg-white/55" />
          </span>
        </div>
      </div>
    </div>
  );
}
