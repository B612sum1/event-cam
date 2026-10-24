"use client";

/**
 * 選んだ写真を、フィルムのコマが並んだ1枚の画像（ベタ焼き）にする。
 *
 * スマホのメモリを使い切らないよう、写真は1枚ずつ取ってきて描き、すぐ捨てる。
 * iPhone の canvas の上限（約1,670万画素）に収まる大きさにしている。
 */

/** フィルム1本分 */
export const CONTACT_SHEET_MAX = 36;

export type SheetItem = { url: string; frame: number; who: string };

type Options = {
  title: string;
  date: Date;
  onProgress?: (done: number, total: number) => void;
};

const FILM = "#24170e";
const PAGE = "#0f0b08";
const EDGE = "#f0a53c";
const HOLE = "rgba(233, 220, 194, 0.8)";
const SANS = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif';
const COND = '"DIN Condensed", "DIN Alternate", "Roboto Condensed", "Arial Narrow", sans-serif';

async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("写真を取得できませんでした");
  return createImageBitmap(await res.blob());
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

export async function renderContactSheet(items: SheetItem[], { title, date, onProgress }: Options): Promise<Blob> {
  const list = items.slice(0, CONTACT_SHEET_MAX);
  const n = list.length;
  const cols = n <= 4 ? 2 : n <= 12 ? 3 : 4;
  const rows = Math.ceil(n / cols);

  const W = cols === 4 ? 2000 : 2400;
  const margin = Math.round(W * 0.03);
  const cellW = (W - margin * 2) / cols;
  const padX = Math.round(cellW * 0.03);
  const photoW = cellW - padX * 2;
  const photoH = Math.round((photoW * 4) / 3);
  const u = W / 2000; // 文字や穴の大きさの基準
  const holeBand = Math.round(30 * u);
  const edgeBand = Math.round(34 * u);
  const nameBand = Math.round(34 * u);
  const rowH = holeBand + edgeBand + photoH + nameBand + holeBand;
  const rowGap = Math.round(16 * u);
  const header = Math.round(150 * u);
  const footer = Math.round(70 * u);
  const H = header + rows * rowH + (rows - 1) * rowGap + footer;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を作れませんでした");
  ctx.imageSmoothingQuality = "high";

  // 台紙
  ctx.fillStyle = PAGE;
  ctx.fillRect(0, 0, W, H);

  // 見出し：EVENT CAM ／ イベント名と日付
  ctx.textBaseline = "alphabetic";
  ctx.font = `italic 700 ${Math.round(54 * u)}px ${COND}`;
  ctx.fillStyle = "#f5f5f7";
  const baseY = Math.round(header * 0.62);
  ctx.fillText("EVENT", margin, baseY);
  const eventW = ctx.measureText("EVENT ").width;
  ctx.fillStyle = "#4fb3a9";
  ctx.fillText("CAM", margin + eventW, baseY);

  ctx.textAlign = "right";
  ctx.fillStyle = "#f5f5f7";
  ctx.font = `700 ${Math.round(38 * u)}px ${SANS}`;
  ctx.fillText(truncate(ctx, title, W * 0.55), W - margin, baseY - Math.round(10 * u));
  ctx.fillStyle = "rgba(235, 235, 245, 0.6)";
  ctx.font = `400 ${Math.round(26 * u)}px ${SANS}`;
  const d = `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}　${n}コマ`;
  ctx.fillText(d, W - margin, baseY + Math.round(32 * u));
  ctx.textAlign = "left";

  // フィルムの帯（行ごと）と送り穴
  for (let r = 0; r < rows; r++) {
    const y = header + r * (rowH + rowGap);
    const inRow = Math.min(cols, n - r * cols);
    const stripW = inRow * cellW;
    ctx.fillStyle = FILM;
    ctx.fillRect(margin, y, stripW, rowH);
    ctx.fillStyle = HOLE;
    const holeW = Math.round(20 * u);
    const holeH = Math.round(14 * u);
    const pitch = Math.round(40 * u);
    for (let x = margin + pitch / 2; x + holeW < margin + stripW; x += pitch) {
      ctx.fillRect(x, y + (holeBand - holeH) / 2, holeW, holeH);
      ctx.fillRect(x, y + rowH - holeBand + (holeBand - holeH) / 2, holeW, holeH);
    }
  }

  // コマ
  for (let i = 0; i < n; i++) {
    const item = list[i];
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x0 = margin + c * cellW + padX;
    const y0 = header + r * (rowH + rowGap);

    // 縁の文字（コマ番号）
    ctx.fillStyle = EDGE;
    ctx.font = `700 ${Math.round(26 * u)}px ${COND}`;
    const edgeY = y0 + holeBand + Math.round(edgeBand * 0.78);
    ctx.textAlign = "left";
    ctx.fillText(`▸${item.frame}`, x0, edgeY);
    ctx.textAlign = "right";
    ctx.fillText(`${item.frame}A`, x0 + photoW, edgeY);
    ctx.textAlign = "left";

    // 写真（3:4 に中央から切り抜き）
    const py = y0 + holeBand + edgeBand;
    ctx.fillStyle = "#000";
    ctx.fillRect(x0, py, photoW, photoH);
    try {
      const bmp = await loadBitmap(item.url);
      let sw = bmp.width;
      let sh = bmp.height;
      if (sw / sh > 3 / 4) sw = sh * (3 / 4);
      else sh = sw / (3 / 4);
      ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, x0, py, photoW, photoH);
      bmp.close();
    } catch {
      /* 1枚読めなくても、黒いコマのまま続ける */
    }

    // 撮った人
    ctx.fillStyle = "rgba(240, 165, 60, 0.8)";
    ctx.font = `500 ${Math.round(22 * u)}px ${SANS}`;
    ctx.fillText(truncate(ctx, item.who, photoW), x0, py + photoH + Math.round(nameBand * 0.75));

    onProgress?.(i + 1, n);
  }

  // フッター
  ctx.fillStyle = "rgba(235, 235, 245, 0.35)";
  ctx.font = `400 ${Math.round(20 * u)}px ${SANS}`;
  ctx.textAlign = "right";
  ctx.fillText("Event Cam でみんなが撮った写真", W - margin, H - Math.round(footer * 0.4));

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  canvas.width = canvas.height = 0; // メモリを早めに返す
  if (!blob) throw new Error("画像を作れませんでした");
  return blob;
}
