"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCcw, SwitchCamera, Timer, TimerOff } from "lucide-react";
import { SegmentDate } from "@/components/SegmentDate";
import { applyFilmEffect } from "@/lib/utils/filmEffect";
import { compressImage, createThumbnail, type CompressedImage } from "@/lib/utils/imageCompression";

/** ファインダーの縦横比（インスタントフィルム風の縦長 3:4） */
const FRAME_ASPECT = 3 / 4;
/** 保存する写真の長辺(px)。2448 × 3264（約800万画素）。元の映像・写真より大きくは引き伸ばさない */
const MAX_CAPTURE_EDGE = 3264;

/** Chrome（主に Android）の静止画撮影 API。標準カメラに近い解像度・ノイズ処理で撮れる */
type ImageCaptureLike = { takePhoto: (settings?: { fillLightMode?: string }) => Promise<Blob> };
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

/**
 * 静止画撮影 API が使える端末では、動画の1コマではなく本物の写真を撮る。
 * 使えない端末（iPhone など）や失敗・時間切れのときは null を返し、動画の1コマで撮る。
 */
async function takeStillPhoto(track: MediaStreamTrack | null, expectPortrait: boolean): Promise<ImageBitmap | null> {
  const Ctor = (window as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
  if (!track || !Ctor || track.readyState !== "live") return null;
  try {
    const capture = new Ctor(track);
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000));
    // 本物のフラッシュは光らせない（未対応の端末では設定なしで撮り直す）
    const blob = await Promise.race([
      capture.takePhoto({ fillLightMode: "off" }).catch(() => capture.takePhoto()),
      timeout,
    ]);
    const bitmap = await createImageBitmap(blob);
    // 端末によっては縦持ちでも横向きの写真が返るので、その場合は使わない
    if (expectPortrait !== bitmap.height > bitmap.width) {
      bitmap.close();
      return null;
    }
    return bitmap;
  } catch {
    return null;
  }
}

type Facing = "environment" | "user";

/** セルフタイマーの秒数（0 = オフ）。ボタンを押すたびに順に切り替わる */
const TIMER_STEPS = [0, 3, 10] as const;
type TimerSec = (typeof TIMER_STEPS)[number];
const TIMER_KEY = "event-cam:self-timer";

/** カウントダウンの「ピッ」。音が出せない端末では何もしない */
function beep(ctx: AudioContext | null, high = false) {
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = high ? 1760 : 1320;
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } catch {
    /* 音は鳴らなくても撮影は続ける */
  }
}


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
  /** 撮影時間外など、ファインダーに重ねて表示する案内（表示中はシャッターを押せない） */
  blocked?: { title: string; body: string } | null;
  /**
   * 圧縮済みの画像を受け取り、保存できたら true を返す。
   * true の場合のみ「フィルムが出てくる」演出を出す。
   */
  onCapture: (shot: { image: CompressedImage; thumb: CompressedImage | null }) => Promise<boolean>;
};

export function CameraView({ remaining, maxPhotos, disabled, blocked, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  const [facing, setFacing] = useState<Facing>("environment");
  const [retryKey, setRetryKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<CameraError | null>(null);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  const [ejected, setEjected] = useState<{ key: number; url: string } | null>(null);
  const [windKey, setWindKey] = useState(0);

  // セルフタイマー：設定は端末に覚えておく（次に開いたときも同じ秒数）
  // （カメラ画面はブラウザ側でだけ描画されるので、最初から保存値を読める）
  const [timer, setTimer] = useState<TimerSec>(() => {
    try {
      const saved = Number(localStorage.getItem(TIMER_KEY));
      return (TIMER_STEPS as readonly number[]).includes(saved) ? (saved as TimerSec) : 0;
    } catch {
      return 0;
    }
  });
  const [countdown, setCountdown] = useState<number | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const cycleTimer = () => {
    const next = TIMER_STEPS[(TIMER_STEPS.indexOf(timer) + 1) % TIMER_STEPS.length];
    setTimer(next);
    try {
      localStorage.setItem(TIMER_KEY, String(next));
    } catch {
      /* 覚えられなくても切り替えはできる */
    }
  };
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
            // 端末が出せる一番高い解像度に近いものを選んでもらう
            width: { ideal: 4096 },
            height: { ideal: 3072 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (!video) return;
        video.srcObject = stream;
        trackRef.current = stream.getVideoTracks()[0] ?? null;
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
      trackRef.current = null;
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
  const canShoot = ready && !processing && !disabled && !blocked && remaining > 0;

  const shoot = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !canShoot) return;
    if (!video.videoWidth || !video.videoHeight) return;

    setProcessing(true);
    setFlashKey((k) => k + 1);
    navigator.vibrate?.(30);

    try {
      // 写真の元：静止画撮影できればそれを、できなければ動画の1コマを使う
      const still = await takeStillPhoto(trackRef.current, video.videoHeight > video.videoWidth);
      const source: CanvasImageSource = still ?? video;
      // プレビュー（object-cover）と同じ範囲を中央から切り出す
      const vw = still ? still.width : video.videoWidth;
      const vh = still ? still.height : video.videoHeight;
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
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      still?.close();
      // フィルムカメラ風の色・粒子・周辺減光・光漏れ・日付を焼き込む
      applyFilmEffect(ctx, canvas.width, canvas.height, { date: new Date() });

      const raw = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.96),
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

  // ---- セルフタイマー -----------------------------------------------------
  const shootRef = useRef(shoot);
  const canShootRef = useRef(canShoot);
  useEffect(() => {
    shootRef.current = shoot;
    canShootRef.current = canShoot;
  }, [shoot, canShoot]);

  /** シャッターボタン：タイマーがオンなら数え始め、数えている最中に押すと止める */
  const pressShutter = useCallback(() => {
    if (countdown !== null && canShoot) {
      setCountdown(null);
      return;
    }
    if (!canShoot) return;
    if (timer === 0) {
      void shoot();
      return;
    }
    // 音はユーザー操作の中でないと鳴らせない端末があるので、ここで準備する
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!audioRef.current && Ctx) audioRef.current = new Ctx();
      void audioRef.current?.resume();
    } catch {
      /* 音なしで続ける */
    }
    setCountdown(timer);
  }, [countdown, canShoot, timer, shoot]);

  // 1秒ごとに数を減らし、0 になったら撮る。
  // 途中で撮れなくなったら（撮影時間が終わった・カメラが止まった など）そこでやめる
  useEffect(() => {
    if (countdown === null) return;
    beep(audioRef.current, countdown <= 2);
    navigator.vibrate?.(countdown <= 2 ? 20 : 8);
    const t = window.setTimeout(() => {
      if (!canShootRef.current) {
        setCountdown(null);
      } else if (countdown <= 1) {
        setCountdown(null);
        void shootRef.current();
      } else {
        setCountdown(countdown - 1);
      }
    }, 1000);
    return () => window.clearTimeout(t);
  }, [countdown]);

  useEffect(
    () => () => {
      void audioRef.current?.close().catch(() => {});
    },
    [],
  );

  // PC ではスペースキーでも撮影できる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        pressShutter();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pressShutter]);

  const counting = countdown !== null && canShoot;

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

          {ready && !error && (
            <button
              type="button"
              onClick={cycleTimer}
              disabled={processing || counting}
              aria-label={timer ? `セルフタイマー ${timer}秒（押すと切り替え）` : "セルフタイマー オフ（押すと切り替え）"}
              className={`absolute top-3 left-3 flex h-11 min-w-11 items-center justify-center gap-1 rounded-full px-3 backdrop-blur-sm transition active:scale-95 disabled:opacity-40 ${
                timer ? "bg-accent text-black" : "bg-black/40 text-white"
              }`}
            >
              {timer ? <Timer className="size-5" /> : <TimerOff className="size-5" />}
              {timer > 0 && <span className="cond text-[17px] leading-none">{timer}s</span>}
            </button>
          )}

          {/* セルフタイマーのカウントダウン：赤いランプの点滅 + 大きな数字 */}
          {counting && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center" role="status" aria-live="assertive">
              <span
                className={`absolute top-[18px] left-1/2 size-3 -translate-x-1/2 rounded-full bg-[#ff453a] shadow-[0_0_14px_4px_rgb(255_69_58/0.7)] ${
                  countdown <= 2 ? "animate-[pulse_0.35s_ease-in-out_infinite]" : "animate-pulse"
                }`}
              />
              <span
                key={countdown}
                className="cond animate-tick text-[min(42vw,180px)] leading-none text-white [text-shadow:0_4px_30px_rgb(0_0_0/0.5)]"
              >
                {countdown}
              </span>
              <span className="sr-only">{countdown}秒後に撮影します</span>
            </div>
          )}

          {hasMultipleCameras && ready && (
            <button
              type="button"
              onClick={switchCamera}
              disabled={processing || counting}
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

          {blocked && ready && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/72 px-8 text-center">
              <p className="text-[22px] font-bold tracking-[-0.01em]">{blocked.title}</p>
              <p className="text-sm text-label-2">{blocked.body}</p>
            </div>
          )}

          {!blocked && remaining <= 0 && ready && (
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
          onClick={pressShutter}
          disabled={!canShoot && !counting}
          aria-label={
            counting
              ? "セルフタイマーを止める"
              : `シャッターを切る（${timer ? `${timer}秒後、` : ""}残り${Math.max(remaining, 0)}枚）`
          }
          className={`grid size-[82px] touch-manipulation place-items-center rounded-full border-4 p-1 transition active:scale-[0.95] disabled:opacity-35 ${
            counting ? "border-[#ff453a]" : "border-white"
          }`}
        >
          <span
            className={`grid size-full place-items-center transition-all ${counting ? "scale-[0.5] rounded-[12px] bg-[#ff453a]" : "rounded-full bg-white"}`}
          >
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
