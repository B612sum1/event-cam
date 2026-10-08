"use client";

/**
 * 撮影画像に「フィルムカメラ風」の加工を焼き込む（canvas 上で直接処理）。
 *
 * 1. トーンカーブ：黒を少し浮かせ、白を少し抑えた柔らかいコントラスト
 * 2. スプリットトーン：シャドウはわずかに青緑、ハイライトは暖色
 * 3. 彩度を少し下げる
 * 4. 周辺減光（ビネット）
 * 5. 中間調に強く乗るフィルムグレイン
 * 6. ランダムな光漏れ（ライトリーク）
 * 7. 使い捨てカメラ風のオレンジ色の日付
 *
 * 1920×1440 程度の画像で、スマホでも 100ms 前後で終わる程度の軽い処理にしている。
 */

export type FilmOptions = {
  /** 日付を写し込む場合の日時。null なら入れない */
  date?: Date | null;
  /** グレインの強さ（0〜30 程度） */
  grain?: number;
  /** 周辺減光の強さ（0〜1） */
  vignette?: number;
  /** 光漏れが入る確率（0〜1） */
  lightLeakChance?: number;
};

const DEFAULTS = { grain: 14, vignette: 0.38, lightLeakChance: 0.35 };

// ---- トーンカーブ（チャンネルごとのルックアップテーブル） --------------------
let curves: { r: Uint8ClampedArray; g: Uint8ClampedArray; b: Uint8ClampedArray } | null = null;

function getCurves() {
  if (curves) return curves;
  const r = new Uint8ClampedArray(256);
  const g = new Uint8ClampedArray(256);
  const b = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    // ゆるい S 字カーブ（コントラストを少しだけ付ける）
    const s = x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
    const y = x * 0.6 + s * 0.4;
    // 黒浮き + スプリットトーン（黒：やや青緑 / 白：暖色）
    r[i] = (0.07 + y * 0.95) * 255;
    g[i] = (0.065 + y * 0.9) * 255;
    b[i] = (0.085 + y * 0.78) * 255;
  }
  curves = { r, g, b };
  return curves;
}

/** 高速な疑似乱数（Math.random より速く、グレイン用途には十分） */
function xorshift(seed: number) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function applyFilmEffect(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: FilmOptions = {},
) {
  const grain = options.grain ?? DEFAULTS.grain;
  const vignette = options.vignette ?? DEFAULTS.vignette;
  const leakChance = options.lightLeakChance ?? DEFAULTS.lightLeakChance;

  const image = ctx.getImageData(0, 0, width, height);
  const px = image.data;
  const { r: cr, g: cg, b: cb } = getCurves();
  const rand = xorshift(Date.now());

  const cx = width / 2;
  const cy = height / 2;
  const maxD2 = cx * cx + cy * cy;
  const SAT = 0.86;

  for (let y = 0; y < height; y++) {
    const dy2 = (y - cy) * (y - cy);
    let i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4) {
      let r = cr[px[i]];
      let g = cg[px[i + 1]];
      let b = cb[px[i + 2]];

      // 彩度を下げる
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = lum + (r - lum) * SAT;
      g = lum + (g - lum) * SAT;
      b = lum + (b - lum) * SAT;

      // 周辺減光：中心からの距離 0.5 以降でなだらかに暗く
      const d = ((x - cx) * (x - cx) + dy2) / maxD2; // 0〜1（距離の2乗）
      if (d > 0.25) {
        const t = Math.min(1, (d - 0.25) / 0.75);
        const v = 1 - vignette * t * t * (3 - 2 * t);
        r *= v;
        g *= v;
        b *= v;
      }

      // グレイン：中間調ほど強く、モノクロで乗せる
      const w = 1 - Math.abs(lum - 128) / 170;
      const n = (rand() + rand() - 1) * grain * (w > 0.2 ? w : 0.2);
      px[i] = r + n;
      px[i + 1] = g + n;
      px[i + 2] = b + n;
    }
  }
  ctx.putImageData(image, 0, 0);

  if (rand() < leakChance) drawLightLeak(ctx, width, height, rand);
  if (options.date) drawDateStamp(ctx, width, height, options.date);
}

/** フィルムの端から差し込むオレンジ〜赤の光漏れ */
function drawLightLeak(ctx: CanvasRenderingContext2D, w: number, h: number, rand: () => number) {
  const fromLeft = rand() < 0.5;
  const x = fromLeft ? -w * 0.15 : w * 1.15;
  const y = h * (0.15 + rand() * 0.7);
  const radius = Math.max(w, h) * (0.45 + rand() * 0.3);

  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, "rgba(255, 170, 70, 0.55)");
  gradient.addColorStop(0.35, "rgba(255, 90, 50, 0.28)");
  gradient.addColorStop(0.7, "rgba(220, 40, 90, 0.08)");
  gradient.addColorStop(1, "rgba(220, 40, 90, 0)");

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// ---- 日付（使い捨てカメラの7セグメントLCD風） -------------------------------

/** 写真に入る日付：令和表記の「R8 10 9」。撮影した日時から自動で決まり、変更できない */
export function formatFilmDate(date: Date) {
  const reiwa = date.getFullYear() - 2018; // 2019年 = 令和1年
  return `R${reiwa} ${date.getMonth() + 1} ${date.getDate()}`;
}

/*
 * 7セグメントの形（1文字 = 幅1 × 高さ2 の箱）
 *   a
 * f   b
 *   g
 * e   c
 *   d      R は a,b,f,g,e + 右下への斜め線
 */
type Seg = [number, number, number, number];
const SEG: Record<string, Seg> = {
  a: [0, 0, 1, 0],
  b: [1, 0, 1, 1],
  c: [1, 1, 1, 2],
  d: [0, 2, 1, 2],
  e: [0, 1, 0, 2],
  f: [0, 0, 0, 1],
  g: [0, 1, 1, 1],
  r: [0.45, 1, 1, 2],
};
const GLYPHS: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
  "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg",
  R: "abfger", "-": "g",
};
const SLANT = 0.12; // 右に少し傾ける
const GAP = 0.13; // 線同士のすき間
const ADVANCE = 1.62; // 1文字の送り幅
const SPACE = 0.95; // 空白の送り幅

/**
 * 文字列を線分の集まりに変換する（単位：文字の高さの半分）。
 * 写真への焼き込み（canvas）とプレビュー（SVG）で同じ形を使うための共通処理。
 */
export function segmentLines(text: string) {
  const lines: Seg[] = [];
  let x = 0;
  for (const ch of text) {
    if (ch === " ") {
      x += SPACE;
      continue;
    }
    for (const key of GLYPHS[ch] ?? "") {
      const [x1, y1, x2, y2] = SEG[key];
      const len = Math.hypot(x2 - x1, y2 - y1);
      const ux = ((x2 - x1) / len) * GAP;
      const uy = ((y2 - y1) / len) * GAP;
      const p = (px: number, py: number): [number, number] => [x + px + (2 - py) * SLANT, py];
      const [ax, ay] = p(x1 + ux, y1 + uy);
      const [bx, by] = p(x2 - ux, y2 - uy);
      lines.push([ax, ay, bx, by]);
    }
    x += ADVANCE;
  }
  return { lines, width: x - (ADVANCE - 1) + 2 * SLANT, height: 2 };
}

/** 黄色く光るLCDの日付（右下） */
function drawDateStamp(ctx: CanvasRenderingContext2D, w: number, h: number, date: Date) {
  const { lines, width } = segmentLines(formatFilmDate(date));
  const digitH = Math.round(Math.min(w, h) * 0.046); // 数字1文字の高さ
  const u = digitH / 2;
  const left = w - w * 0.1 - width * u;
  const top = h - h * 0.075 - digitH;

  const stroke = (lineWidth: number, color: string, blur: number, glow: string) => {
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of lines) {
      ctx.moveTo(left + x1 * u, top + y1 * u);
      ctx.lineTo(left + x2 * u, top + y2 * u);
    }
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.shadowColor = glow;
    ctx.shadowBlur = blur;
    ctx.stroke();
  };

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // 外側のにじみ → 芯の順に重ねる
  stroke(u * 0.3, "rgba(235, 170, 40, 0.45)", u * 0.8, "rgba(230, 140, 10, 0.8)");
  stroke(u * 0.19, "rgba(246, 206, 82, 0.92)", u * 0.22, "rgba(240, 170, 30, 0.85)");
  ctx.restore();
}
