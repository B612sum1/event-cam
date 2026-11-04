import { messages, type Lang } from "@/lib/i18n/messages";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_RE.test(value);

export function isRevealed(revealAt: string | null, now = Date.now()): boolean {
  return revealAt === null || new Date(revealAt).getTime() <= now;
}

const LOCALE: Record<Lang, string> = { ja: "ja-JP", en: "en-US" };
const formatters = new Map<string, Intl.DateTimeFormat>();
const fmt = (lang: Lang, key: string, options: Intl.DateTimeFormatOptions) => {
  const id = `${lang}:${key}`;
  let f = formatters.get(id);
  if (!f) formatters.set(id, (f = new Intl.DateTimeFormat(LOCALE[lang], options)));
  return f;
};

/** 「10月24日(土) 19:35」/「Sat, Oct 24, 7:35 PM」 */
export const formatDateTime = (iso: string, lang: Lang = "ja") =>
  fmt(lang, "dt", { month: lang === "ja" ? "long" : "short", day: "numeric", weekday: "short", hour: lang === "ja" ? "2-digit" : "numeric", minute: "2-digit" }).format(
    new Date(iso),
  );

export const formatTime = (iso: string, lang: Lang = "ja") =>
  fmt(lang, "t", { hour: lang === "ja" ? "2-digit" : "numeric", minute: "2-digit" }).format(new Date(iso));

/** 「2026.10.24」（ベタ焼きの見出し用） */
export const formatDotDate = (date: Date) => `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;

// ---- 撮影できる時間 ----------------------------------------------------------

export type ShootingState = "before" | "open" | "closed";

/** 画面表示用の判定（本当の判定はデータベースがサーバー時刻で行う） */
export function getShootingState(
  window: { shoot_start_at: string | null; shoot_end_at: string | null },
  now = Date.now(),
): ShootingState {
  if (window.shoot_start_at && now < new Date(window.shoot_start_at).getTime()) return "before";
  if (window.shoot_end_at && now >= new Date(window.shoot_end_at).getTime()) return "closed";
  return "open";
}

const shortDateTime = (iso: string, lang: Lang) =>
  `${fmt(lang, "sd", lang === "ja" ? { month: "numeric", day: "numeric", weekday: "short" } : { weekday: "short", month: "short", day: "numeric" }).format(new Date(iso))} ${formatTime(iso, lang)}`;
const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();

/** 「10/10(土) 18:00〜21:00」「21:00まで」「いつでも」など */
export function formatShootWindow(start: string | null, end: string | null, lang: Lang = "ja"): string {
  const t = messages[lang].time;
  if (start && end) {
    return t.range(shortDateTime(start, lang), sameDay(start, end) ? formatTime(end, lang) : shortDateTime(end, lang));
  }
  if (start) return t.from(shortDateTime(start, lang));
  if (end) return t.until(shortDateTime(end, lang));
  return t.anytime;
}

/** <input type="datetime-local"> 用の値（ローカル時刻）に変換 */
export function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** アプリ内で投げるエラーの種類（画面では今の言語の文に置き換える） */
export const FETCH_FAILED = "fetch_failed";
export const IMAGE_FAILED = "image_failed";

/** Supabase などのエラーを、利用者向けの文に寄せる */
export function toFriendlyError(error: unknown, lang: Lang = "ja"): string {
  const e = messages[lang].errors;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);

  if (message.includes("photo_limit_reached")) return e.photoLimit;
  if (message.includes("shooting_not_started")) return e.notStarted;
  if (message.includes("shooting_closed")) return e.closed;
  if (message.includes("Failed to fetch") || message.includes("NetworkError") || message.includes("Load failed"))
    return e.network;
  if (message.includes("row-level security") || message.includes("Unauthorized")) return e.forbidden;
  if (message === FETCH_FAILED) return e.fetchPhoto;
  if (message === IMAGE_FAILED) return e.makeImage;
  if (message === "photo_unreadable") return e.unreadable;
  return message;
}
