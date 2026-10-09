"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCcw, SwitchCamera } from "lucide-react";
import { SegmentDate } from "@/components/SegmentDate";
import { applyFilmEffect } from "@/lib/utils/filmEffect";
import { compressImage, createThumbnail, type CompressedImage } from "@/lib/utils/imageCompression";

/** ファインダーの縦横比（インスタントフィルム風の縦長 3:4） */
const FRAME_ASPECT = 3 / 4;
/** canvas に描く時点での長辺上限（圧縮前に縮めておくと圧縮が速い） */
const MAX_CAPTURE_EDGE = 1920;

type Facing = "environment" | "user";


type CameraError =
  | { kind: "insecure" }
  | { kind: "denied" }
  | { kind: "not-found" }
  | { kind: "in-use" }
  | { kind: "unknown"; message: string };

type Props = {
  remaining: number;
  maxPhotos: number;
  /** 親がアップロード中など、シャッターを押せない状態 */
  disabled?: boolean;
  /**
   * 圧縮済みの画像を受け取り、保存できたら true を返す。
   * true の場合のみ「フィルムが出てくる」演出を出す。
   */
  onCapture: (shot: { image: CompressedImage; thumb: CompressedImage | null }) => Promise<boolean>;
};

export function CameraView({ remaining, maxPhotos, disabled, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [facing, setFacing] = useState<Facing>("environment");
  const [retryKey, setRetryKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<CameraError | null>(null);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  const [ejected, setEjected] = useState<{ key: number; url: string } | null>(null);
  const [windKey, setWindKey] = useState(0);
  // 日付は撮影した瞬間の日時で自動的に入る（ゲストは変更できない）。表示用に1分ごとに更新
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // ---- カメラ起動 / 停止 ------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    const video = videoRef.current;

    const start = async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError({ kind: "insecure" });
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 2560 },
            height: { ideal: 1920 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => {
          /* iOS で稀に失敗するが autoplay + muted + playsInline で再生される */
        });
        if (cancelled) return;
        setError(null);
        setReady(true);

        // 許可後でないとデバイス一覧にラベルが出ないので、ここで確認
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) {
          setHasMultipleCameras(devices.filter((d) => d.kind === "videoinput").length > 1);
        }
      } catch (e) {
        if (cancelled) return;
        const name = e instanceof DOMException ? e.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") setError({ kind: "denied" });
        else if (name === "NotFoundError" || name === "OverconstrainedError")
          setError({ kind: "not-found" });
        else if (name === "NotReadableError" || name === "AbortError") setError({ kind: "in-use" });
        else setError({ kind: "unknown", message: e instanceof Error ? e.message : String(e) });
      }
    };

    void start();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
    };
  }, [facing, retryKey]);

  // 撮影済みフィルムのプレビューURLを後始末
  useEffect(() => {
    if (!ejected) return;
    const t = window.setTimeout(() => {
      setEjected((cur) => (cur?.key === ejected.key ? null : cur));
    }, 1900);
    return () => {
      window.clearTimeout(t);
      URL.revokeObjectURL(ejected.url);
    };
  }, [ejected]);

  const switchCamera = () => {
    setReady(false);
    setFacing((f) => (f === "environment" ? "user" : "environment"));
  };

  const retry = () => {
    setError(null);
    setReady(false);
    setRetryKey((k) => k + 1);
  };

  // ---- 撮影 --------------------------------------------------------------
  const canShoot = ready && !processing && !disabled && remaining > 0;

  const shoot = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !canShoot) return;
    if (!video.videoWidth || !video.videoHeight) return;

    setProcessing(true);
    setFlashKey((k) => k + 1);
    navigator.vibrate?.(30);

    try {
      // プレビュー（object-cover）と同じ範囲を中央から切り出す
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      let sw = vw;
      let sh = vh;
      if (vw / vh > FRAME_ASPECT) sw = vh * FRAME_ASPECT;
      else sh = vw / FRAME_ASPECT;
      const sx = (vw - sw) / 2;
      const sy = (vh - sh) / 2;

      const scale = Math.min(1, MAX_CAPTURE_EDGE / Math.max(sw, sh));
      canvas.width = Math.round(sw * scale);
      canvas.height = Math.round(sh * scale);

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas が使えません");
      // プレビューはインカメラ時に鏡像表示しているが、保存する写真は正像にする（iOS 標準カメラと同じ）
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      // フィルムカメラ風の色・粒子・周辺減光・光漏れ・日付を焼き込む
      applyFilmEffect(ctx, canvas.width, canvas.height, { date: new Date() });

      const raw = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92),
      );
      if (!raw) throw new Error("画像の取得に失敗しました");

      // 元の写真（拡大・保存用）と、一覧用の小さい写真を作る
      const [compressed, thumb] = await Promise.all([
        compressImage(raw),
        createThumbnail(canvas).catch(() => null),
      ]);
      const ok = await onCapture({ image: compressed, thumb });
      if (ok) {
        setEjected({ key: Date.now(), url: URL.createObjectURL(compressed.file) });
        setWindKey((k) => k + 1); // 巻き上げダイヤルを回す
      }
    } finally {
      setProcessing(false);
    }
  }, [canShoot, onCapture]);

  // PC ではスペースキーでも撮影できる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        void shoot();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shoot]);

  // ---- 描画 --------------------------------------------------------------
  return (
    <div className="flex w-full flex-1 flex-col items-center">
      {/* ファインダー */}
      <div className="relative w-full max-w-md px-3">
        <div
          className="relative w-full overflow-hidden rounded-[22px] bg-[#0d0c0b]"
          style={{ aspectRatio: `${FRAME_ASPECT}` }}
        >
          <video
            ref={videoRef}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
              ready ? "opacity-100" : "opacity-0"
            } ${facing === "user" ? "-scale-x-100" : ""}`}
            // 保存される写真に近い色味をファインダーでも再現（実際の加工は撮影時に canvas で行う）
            style={{ filter: "sepia(0.14) saturate(0.86) contrast(0.92) brightness(1.04)" }}
            autoPlay
            muted
            playsInline
          />

          {/* フィルム風プレビュー：周辺減光 + 粒子 + 日付（写真に入る日付と同じ位置・形） */}
          {ready && (
            <>
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_52%,rgb(0_0_0/0.38)_100%)]" />
              <div className="film-grain pointer-events-none absolute inset-0 opacity-60 mix-blend-overlay" />
              <SegmentDate date={now} height={16} className="pointer-events-none absolute right-[9%] bottom-[6%]" />
            </>
          )}

          {hasMultipleCameras && ready && (
            <button
              type="button"
              onClick={switchCamera}
              disabled={processing}
              aria-label="インカメラ・外カメラを切り替え"
              className="absolute top-3 right-3 grid size-11 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm transition active:scale-95 disabled:opacity-40"
            >
              <SwitchCamera className="size-5" />
            </button>
          )}

          {!ready && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-label-3">
              <Loader2 className="size-7 animate-spin" aria-label="カメラを起動中" />
            </div>
          )}

          {error && <CameraErrorPanel error={error} onRetry={retry} />}

          {remaining <= 0 && ready && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/72 px-8 text-center">
              <p className="text-[22px] font-bold tracking-[-0.01em]">撮り終えました。</p>
              <p className="text-sm text-label-2">あとは、現像を待つだけ。</p>
            </div>
          )}

          {/* フラッシュ */}
          {flashKey > 0 && (
            <div key={flashKey} className="pointer-events-none absolute inset-0 animate-flash bg-white" />
          )}
        </div>

        {/* 出てくるフィルム */}
        {ejected && (
          <div
            key={ejected.key}
            className="pointer-events-none absolute -bottom-6 left-7 w-24 animate-eject rounded-[3px] bg-sticker p-1.5 pb-5 shadow-xl"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ejected.url} alt="" className="aspect-[3/4] w-full object-cover blur-[6px] brightness-75 sepia" />
          </div>
        )}
      </div>

      {/* 操作部：日付（表示のみ）／ シャッター ／ フィルムカウンター + 巻き上げダイヤル */}
      <div className="mt-auto grid w-full max-w-md grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 pt-8">
        <div className="flex justify-start">
          {/* 日付は撮影日時で自動的に決まり、変更できない */}
          <span className="flex h-11 items-center rounded-full bg-white/[0.12] px-3.5">
            <SegmentDate date={now} height={14} />
          </span>
        </div>

        <button
          type="button"
          onClick={() => void shoot()}
          disabled={!canShoot}
          aria-label={`シャッターを切る（残り${Math.max(remaining, 0)}枚）`}
          className="grid size-[82px] touch-manipulation place-items-center rounded-full border-4 border-white p-1 transition active:scale-[0.95] disabled:opacity-35"
        >
          <span className="grid size-full place-items-center rounded-full bg-white">
            {processing && <Loader2 className="size-6 animate-spin text-black" />}
          </span>
        </button>

        <div className="flex justify-end">
          <div className="flex h-[50px] items-center gap-1.5 rounded-full bg-white/[0.12] pr-2 pl-1">
            <FilmCounter remaining={Math.max(remaining, 0)} max={maxPhotos} />
            <span
              key={windKey}
              aria-hidden
              className={`h-[34px] w-3.5 rounded-[4px] bg-[repeating-linear-gradient(180deg,#4a4743_0_3px,#161514_3px_6px)] shadow-[inset_2px_0_2px_rgb(255_255_255/0.12),inset_-2px_0_2px_rgb(0_0_0/0.7)] ${
                windKey > 0 ? "animate-wind" : ""
              }`}
            />
          </div>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

/** 使い捨てカメラの小窓のような、数字が回るフィルムカウンター */
function FilmCounter({ remaining, max }: { remaining: number; max: number }) {
  const ROW = 24; // px
  const SIZE = 42;
  const numbers = Array.from({ length: max + 1 }, (_, i) => max - i); // max, max-1, ... 0
  const offset = (max - remaining) * ROW;
  return (
    <span
      className="relative block overflow-hidden rounded-full bg-[linear-gradient(180deg,#9e9a90,#f2efe6_32%,#f2efe6_68%,#9e9a90)]"
      style={{ width: SIZE, height: SIZE }}
      role="img"
      aria-label={`残り${remaining}枚`}
    >
      <span
        className="absolute inset-x-0 transition-transform duration-500 ease-out"
        style={{ transform: `translateY(${-offset + (SIZE - ROW) / 2}px)` }}
      >
        {numbers.map((n) => (
          <span key={n} className="cond flex items-center justify-center text-[22px] leading-none text-ink" style={{ height: ROW }}>
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}

function CameraErrorPanel({ error, onRetry }: { error: CameraError; onRetry: () => void }) {
  const content = {
    insecure: {
      title: "HTTPS で開いてください",
      body: "カメラは安全な接続（https://）でのみ使えます。主催者に共有されたURLを開き直してください。",
    },
    denied: {
      title: "カメラへのアクセスが許可されていません",
      body: "ブラウザの設定でこのサイトのカメラを「許可」にしてから、再試行してください。iPhone は 設定 > Safari > カメラ から変更できます。",
    },
    "not-found": {
      title: "カメラが見つかりません",
      body: "この端末で使えるカメラが見つかりませんでした。",
    },
    "in-use": {
      title: "カメラが使用中です",
      body: "他のアプリやタブでカメラを使っていないか確認して、再試行してください。",
    },
    unknown: {
      title: "カメラを起動できませんでした",
      body: error.kind === "unknown" ? error.message : "",
    },
  }[error.kind];

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0d0c0b] px-8 text-center">
      <p className="text-lg font-bold">{content.title}</p>
      <p className="text-sm leading-relaxed text-label-2">{content.body}</p>
      {error.kind !== "insecure" && (
        <button
          type="button"
          onClick={onRetry}
          className="btn-glass mt-2 h-11 px-5"
        >
          <RefreshCcw className="size-4" /> 再試行
        </button>
      )}
    </div>
  );
}
