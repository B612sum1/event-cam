const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_RE.test(value);

export function isRevealed(revealAt: string | null, now = Date.now()): boolean {
  return revealAt === null || new Date(revealAt).getTime() <= now;
}

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "long",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatDateTime = (iso: string) => dateTimeFormatter.format(new Date(iso));

const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
});

export const formatTime = (iso: string) => timeFormatter.format(new Date(iso));

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

const shortDateFormatter = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short" });
const shortDateTime = (iso: string) => `${shortDateFormatter.format(new Date(iso))} ${formatTime(iso)}`;
const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();

/** 「10/10(土) 18:00〜21:00」「21:00まで」「いつでも」など */
export function formatShootWindow(start: string | null, end: string | null): string {
  if (start && end) {
    return sameDay(start, end)
      ? `${shortDateTime(start)}〜${formatTime(end)}`
      : `${shortDateTime(start)}〜${shortDateTime(end)}`;
  }
  if (start) return `${shortDateTime(start)} から`;
  if (end) return `${shortDateTime(end)} まで`;
  return "いつでも";
}

/** <input type="datetime-local"> 用の値（ローカル時刻）に変換 */
export function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** Supabase のエラーをユーザー向けの日本語に寄せる */
export function toFriendlyError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);

  if (message.includes("photo_limit_reached")) return "撮影できる枚数の上限に達しました。";
  if (message.includes("shooting_not_started")) return "まだ撮影の時間になっていません。";
  if (message.includes("shooting_closed")) return "撮影の時間は終了しました。";
  if (message.includes("Failed to fetch") || message.includes("NetworkError"))
    return "通信できませんでした。電波の良い場所でもう一度お試しください。";
  if (message.includes("row-level security") || message.includes("Unauthorized"))
    return "権限がありません。参加ページからもう一度参加してください。";
  return message;
}
