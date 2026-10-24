"use client";

import { zipSync } from "fflate";

/** 共有シートで一度に渡せる枚数の目安（多すぎると iPhone で失敗することがある） */
const SHARE_LIMIT = 20;

export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|\s]+/g, "_");

const isTouchDevice = () => window.matchMedia("(pointer: coarse)").matches;

/** 署名付きURLから写真を取ってきて File にする */
export async function fetchAsFile(url: string, baseName: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("写真を取得できませんでした");
  const blob = await res.blob();
  const ext = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/png" ? "png" : "webp";
  return new File([blob], safeFileName(`${baseName}.${ext}`), { type: blob.type });
}

function download(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(href);
  }, 10_000);
}

export type SaveResult = "shared" | "downloaded" | "cancelled";

/**
 * 写真を保存する。
 * ・スマホ：共有シート（iPhone は「画像を保存」で写真アプリへ）。枚数が多いときは ZIP
 * ・PC：1枚ならそのまま、複数なら ZIP でダウンロード
 */
export async function saveFiles(files: File[], zipName: string): Promise<SaveResult> {
  if (files.length === 0) return "cancelled";

  if (isTouchDevice() && files.length <= SHARE_LIMIT && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      // 共有できなかった場合はダウンロードに切り替える
    }
  }

  if (files.length === 1) {
    download(files[0], files[0].name);
    return "downloaded";
  }

  // 写真はすでに圧縮済みなので、ZIP では圧縮せずにまとめるだけ（速い）
  const entries: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const f of files) {
    let name = f.name;
    for (let n = 2; used.has(name); n++) name = f.name.replace(/(\.\w+)$/, `_${n}$1`);
    used.add(name);
    entries[name] = new Uint8Array(await f.arrayBuffer());
  }
  const zipped = zipSync(entries, { level: 0 });
  download(new Blob([zipped as BlobPart], { type: "application/zip" }), safeFileName(`${zipName}.zip`));
  return "downloaded";
}
