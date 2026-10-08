"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCcw, SwitchCamera } from "lucide-react";
import { compressImage, type CompressedImage } from "@/lib/utils/imageCompression";

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
  onCapture: (image: CompressedImage) => Promise<boolean>;
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

      const raw = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92),
      );
      if (!raw) throw new Error("画像の取得に失敗しました");

      const compressed = await compressImage(raw);
      const ok = await onCapture(compressed);
      if (ok) {
        setEjected({ key: Date.now(), url: URL.createObjectURL(compressed.file) });
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
  const used = maxPhotos - remaining;

  return (
    <div className="flex w-full flex-1 flex-col items-center">
      {/* ファインダー */}
      <div className="relative w-full max-w-md px-5">
        <div
          className="relative w-full overflow-hidden rounded-[22px] bg-black shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06),0_20px_50px_-20px_rgb(0_0_0/0.8)]"
          style={{ aspectRatio: `${FRAME_ASPECT}` }}
        >
          <video
            ref={videoRef}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
              ready ? "opacity-100" : "opacity-0"
            } ${facing === "user" ? "-scale-x-100" : ""}`}
            autoPlay
            muted
            playsInline
          />

          {/* 四隅のフレーム */}
          <div className="pointer-events-none absolute inset-4">
            {["left-0 top-0 border-l border-t", "right-0 top-0 border-r border-t", "left-0 bottom-0 border-l border-b", "right-0 bottom-0 border-r border-b"].map(
              (pos) => (
                <span key={pos} className={`absolute size-6 border-white/70 ${pos}`} />
              ),
            )}
          </div>

          {!ready && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-white/60">
              <Loader2 className="size-7 animate-spin" aria-label="カメラを起動中" />
            </div>
          )}

          {error && <CameraErrorPanel error={error} onRetry={retry} />}

          {remaining <= 0 && ready && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 px-8 text-center text-white">
              <p className="font-serif text-xl">フィルムを使い切りました</p>
              <p className="text-sm text-white/70"><span className="inline-block">たくさん撮ってくれてありがとう。</span><span className="inline-block">現像をお楽しみに。</span></p>
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
            className="pointer-events-none absolute -bottom-6 left-8 w-24 animate-eject rounded-[3px] bg-[#fbf8f1] p-1.5 pb-5 shadow-xl"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ejected.url} alt="" className="aspect-[3/4] w-full object-cover blur-[6px] brightness-75 sepia" />
          </div>
        )}
      </div>

      {/* 残り枚数（フィルムカウンター） */}
      <div className="mt-6 flex items-center gap-3 text-white/80">
        <span className="font-mono text-[11px] tracking-[0.25em] text-white/40">EXP</span>
        <span className="rounded-md bg-black/40 px-3 py-1 font-mono text-2xl tabular-nums tracking-wider text-[#f3c87a] shadow-inner">
          {String(Math.max(remaining, 0)).padStart(2, "0")}
        </span>
        <span className="text-xs text-white/50">
          残り / {maxPhotos}枚（{used}枚撮影済み）
        </span>
      </div>

      {/* 操作部 */}
      <div className="mt-auto grid w-full max-w-md grid-cols-3 items-center px-8 pt-8">
        <div />
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void shoot()}
            disabled={!canShoot}
            aria-label="シャッター"
            className="group relative grid size-20 place-items-center rounded-full bg-white/10 p-1.5 ring-1 ring-white/25 transition active:scale-95 disabled:opacity-40 touch-manipulation"
          >
            <span className="grid size-full place-items-center rounded-full bg-[#ede6da] shadow-[inset_0_-4px_0_rgb(0_0_0/0.15)] transition group-active:shadow-none">
              {processing ? (
                <Loader2 className="size-6 animate-spin text-body" />
              ) : (
                <span className="size-5 rounded-full bg-accent shadow-[inset_0_1px_2px_rgb(0_0_0/0.35)]" />
              )}
            </span>
          </button>
        </div>
        <div className="flex justify-end">
          {hasMultipleCameras && (
            <button
              type="button"
              onClick={switchCamera}
              disabled={processing}
              aria-label="カメラを切り替え"
              className="grid size-12 place-items-center rounded-full bg-white/10 text-white/85 ring-1 ring-white/15 transition active:scale-95 disabled:opacity-40"
            >
              <SwitchCamera className="size-5" />
            </button>
          )}
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
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
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-body px-8 text-center text-white">
      <p className="font-serif text-lg">{content.title}</p>
      <p className="text-sm leading-relaxed text-white/60">{content.body}</p>
      {error.kind !== "insecure" && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm ring-1 ring-white/20"
        >
          <RefreshCcw className="size-4" /> 再試行
        </button>
      )}
    </div>
  );
}
