"use client";

import imageCompression, { type Options } from "browser-image-compression";

export type CompressedImage = {
  file: File;
  mimeType: "image/webp" | "image/jpeg";
  extension: "webp" | "jpg";
};

/** 仕様: WebP / 長辺1920px以下 / 500KB以下 / quality 0.8 */
export const COMPRESSION_OPTIONS = {
  maxSizeMB: 0.5,
  maxWidthOrHeight: 1920,
  initialQuality: 0.8,
  // 既定の Web Worker は CDN からライブラリを読み込むため、
  // 会場の不安定な回線でも確実に動くようメインスレッドで処理する。
  useWebWorker: false,
} satisfies Options;

let webpEncodeSupported: boolean | null = null;

/**
 * この端末の canvas が WebP にエンコードできるか。
 * iOS Safari など一部ブラウザは WebP を「表示」はできても「書き出し」できず、
 * その場合 toBlob('image/webp') は黙って PNG を返してしまう。
 */
export function canEncodeWebp(): boolean {
  if (webpEncodeSupported !== null) return webpEncodeSupported;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    webpEncodeSupported = canvas
      .toDataURL("image/webp")
      .startsWith("data:image/webp");
  } catch {
    webpEncodeSupported = false;
  }
  return webpEncodeSupported;
}

/**
 * 撮影画像を軽量化する。WebP が書き出せない端末では JPEG にフォールバック。
 */
export async function compressImage(input: Blob): Promise<CompressedImage> {
  const useWebp = canEncodeWebp();
  const mimeType = useWebp ? "image/webp" : "image/jpeg";
  const extension = useWebp ? "webp" : "jpg";

  const source =
    input instanceof File
      ? input
      : new File([input], `capture.${input.type === "image/png" ? "png" : "jpg"}`, {
          type: input.type || "image/jpeg",
        });

  const compressed = await imageCompression(source, {
    ...COMPRESSION_OPTIONS,
    fileType: mimeType,
  });

  // 念のため実際の出力形式を確認（想定外の形式ならJPEGで作り直す）
  if (compressed.type !== mimeType) {
    const jpeg = await imageCompression(source, {
      ...COMPRESSION_OPTIONS,
      fileType: "image/jpeg",
    });
    return {
      file: new File([jpeg], "photo.jpg", { type: "image/jpeg" }),
      mimeType: "image/jpeg",
      extension: "jpg",
    };
  }

  return {
    file: new File([compressed], `photo.${extension}`, { type: mimeType }),
    mimeType,
    extension,
  };
}

/** 一覧用サムネイルの長辺(px)。スマホの3列表示なら十分な大きさ */
export const THUMB_MAX_EDGE = 320;

/**
 * 加工済みの canvas から、一覧用の小さい写真（約15KB）を作る。
 * 一覧ではこれを表示し、元の写真は拡大・保存のときだけ読み込むことで、転送量を約1/16にする。
 */
export async function createThumbnail(source: HTMLCanvasElement): Promise<CompressedImage | null> {
  const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  const useWebp = canEncodeWebp();
  const mimeType = useWebp ? "image/webp" : "image/jpeg";
  const extension = useWebp ? "webp" : "jpg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, 0.72));
  if (!blob || blob.type !== mimeType) return null;
  return { file: new File([blob], `thumb.${extension}`, { type: mimeType }), mimeType, extension };
}
