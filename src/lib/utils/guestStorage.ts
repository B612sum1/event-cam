"use client";

/**
 * 参加情報（guest_id / event_id）を localStorage に保持する。
 * プライベートブラウズ等で localStorage が使えなくても落ちないよう try/catch で包む。
 * localStorage が消えても、匿名ログインのセッション（Cookie）が残っていれば
 * DB から自分の guests 行を引き直せるので、ここはあくまで高速化用のキャッシュ。
 */

export type StoredGuest = {
  guest_id: string;
  event_id: string;
  nickname: string;
};

const key = (eventId: string) => `event-cam:guest:${eventId}`;

export function loadStoredGuest(eventId: string): StoredGuest | null {
  try {
    const raw = window.localStorage.getItem(key(eventId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredGuest;
    return parsed.event_id === eventId && parsed.guest_id ? parsed : null;
  } catch {
    return null;
  }
}

export function saveStoredGuest(guest: StoredGuest): void {
  try {
    window.localStorage.setItem(key(guest.event_id), JSON.stringify(guest));
    // 仕様どおり直近の値も単独キーで保持
    window.localStorage.setItem("guest_id", guest.guest_id);
    window.localStorage.setItem("event_id", guest.event_id);
  } catch {
    /* noop */
  }
}

export function clearStoredGuest(eventId: string): void {
  try {
    window.localStorage.removeItem(key(eventId));
  } catch {
    /* noop */
  }
}
