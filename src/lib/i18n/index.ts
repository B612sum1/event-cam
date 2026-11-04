"use client";

import { useSyncExternalStore } from "react";
import { messages, type Lang } from "./messages";

export type { Lang, Messages } from "./messages";

/**
 * 表示言語。端末ごとに覚えておき、初めての人はスマホの言語設定に合わせる。
 * サーバー描画は日本語で行い、ブラウザで読み込んだあとに切り替わる（ハイドレーションずれを防ぐ）。
 */
const STORAGE_KEY = "event-cam:lang";
const listeners = new Set<() => void>();
let current: Lang | null = null;

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "ja" || saved === "en") return saved;
  } catch {
    /* 保存できない環境でも、端末の言語で表示する */
  }
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return prefs.some((l) => l?.toLowerCase().startsWith("ja")) ? "ja" : "en";
}

function getLang(): Lang {
  if (current === null) {
    current = detect();
    document.documentElement.lang = current;
  }
  return current;
}

export function setLang(lang: Lang) {
  current = lang;
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* 覚えられなくても、この画面では切り替わる */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, () => "ja");
}

/** 今の言語の文言 `t` と言語 `lang` を返す */
export function useI18n() {
  const lang = useLang();
  return { lang, t: messages[lang], setLang };
}
