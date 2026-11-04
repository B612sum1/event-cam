"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PHOTO_BUCKET, type Database } from "@/types";

/**
 * 撮った写真を、送る前にまずスマホの中（IndexedDB）に保存しておく「未送信の箱」。
 * 電波が悪くて送れなかった写真は箱に残り、電波が戻ったら送り直す。
 * ページを閉じても、次に開いたときに送り直せる。
 */

export type PendingShot = {
  /** 撮影ごとの固定ID。送り直しても同じファイル名になるので、二重に保存されない */
  id: string;
  eventId: string;
  guestId: string;
  createdAt: number;
  /**
   * 写真のデータそのもの。iPhone の Safari では、保存した Blob をあとで読み出して送ると
   * 失敗することがあるため、ArrayBuffer で持つ（前の版で保存した Blob も読めるようにしておく）
   */
  image: ArrayBuffer | Blob;
  imageExt: string;
  imageMime: string;
  thumb: ArrayBuffer | Blob | null;
  thumbExt: string | null;
  thumbMime: string | null;
};

const DB_NAME = "event-cam";
const STORE = "pending-shots";

/** IndexedDB が使えない環境（古いブラウザの非公開モードなど）では、このタブの中だけで覚えておく */
const memory = new Map<string, PendingShot>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        if (!db) return reject(new Error("no_idb"));
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export async function addPending(shot: PendingShot) {
  try {
    await run("readwrite", (s) => s.put(shot));
  } catch {
    memory.set(shot.id, shot);
  }
}

export async function removePending(id: string) {
  memory.delete(id);
  try {
    await run("readwrite", (s) => s.delete(id));
  } catch {
    /* 箱に無ければ何もしない */
  }
}

/** このゲストの未送信の写真（古い順） */
export async function listPending(guestId: string): Promise<PendingShot[]> {
  let stored: PendingShot[] = [];
  try {
    stored = await run<PendingShot[]>("readonly", (s) => s.getAll());
  } catch {
    /* メモリ分だけ */
  }
  const all = new Map<string, PendingShot>();
  [...stored, ...memory.values()].forEach((s) => all.set(s.id, s));
  return [...all.values()].filter((s) => s.guestId === guestId).sort((a, b) => a.createdAt - b.createdAt);
}

export const newShotId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------

export type SendResult =
  /** 保存できた（または、もう保存済みだった） */
  | { kind: "sent" }
  /** 電波・タイムアウトなど。あとで送り直す */
  | { kind: "retry"; error: unknown }
  /** 枚数の上限・撮影時間の終了など、送り直しても通らない */
  | { kind: "rejected"; error: unknown };

/** 送り直しても結果が変わらないエラー */
const PERMANENT = /photo_limit_reached|shooting_closed|shooting_not_started|guest_event_mismatch|row-level security|violates|Unauthorized|Bucket not found/i;
const isDuplicate = (e: { message?: string; statusCode?: string | number } | null) =>
  !!e && (String(e.statusCode) === "409" || /already exists|Duplicate/i.test(e.message ?? ""));

const messageOf = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);

/** 弱い電波で通信が止まったままにならないよう、一定時間で切り上げる（送れていても、送り直し時に二重にはならない） */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

const toBlob = (data: ArrayBuffer | Blob, type: string) => (data instanceof Blob ? data : new Blob([data], { type }));

export async function sendShot(supabase: SupabaseClient<Database>, shot: PendingShot): Promise<SendResult> {
  const bucket = supabase.storage.from(PHOTO_BUCKET);
  // ファイル名は「ゲストID_撮影ID」で固定（保存先のルールで、ゲストIDから始まる名前しか置けない）
  const base = `${shot.eventId}/${shot.guestId}_${shot.id}`;
  const path = `${base}.${shot.imageExt}`;
  const uploaded: string[] = [];

  const fail = async (e: unknown): Promise<SendResult> => {
    if (PERMANENT.test(messageOf(e))) {
      // もう通らないので、置いたファイルを片付けて箱から出す
      if (uploaded.length) await bucket.remove(uploaded).catch(() => {});
      return { kind: "rejected", error: e };
    }
    return { kind: "retry", error: e };
  };

  try {
    // 1. 元の写真
    const { error: upErr } = await withTimeout(
      bucket.upload(path, toBlob(shot.image, shot.imageMime), { contentType: shot.imageMime, cacheControl: "31536000", upsert: false }),
      60_000,
    );
    if (upErr && !isDuplicate(upErr as { message?: string; statusCode?: string })) return fail(upErr);
    uploaded.push(path);

    // 2. 一覧用の小さい写真（失敗しても元の写真で表示できるので、電波以外のエラーなら無しで続ける）
    let thumbPath: string | null = null;
    if (shot.thumb && shot.thumbExt) {
      const candidate = `${base}_thumb.${shot.thumbExt}`;
      const { error: thErr } = await withTimeout(
        bucket.upload(candidate, toBlob(shot.thumb, shot.thumbMime ?? "image/jpeg"), { contentType: shot.thumbMime ?? undefined, cacheControl: "31536000", upsert: false }),
        20_000,
      );
      if (!thErr || isDuplicate(thErr as { message?: string; statusCode?: string })) {
        thumbPath = candidate;
        uploaded.push(candidate);
      } else if (!PERMANENT.test(thErr.message)) {
        return { kind: "retry", error: thErr };
      }
    }

    // 3. 前回の送信で記録まで済んでいたら（返事だけ届かなかった場合）、二重に作らない
    const { data: existing, error: findErr } = await withTimeout(
      Promise.resolve(supabase.from("photos").select("id").eq("storage_path", path).maybeSingle()),
      15_000,
    );
    if (findErr) return fail(findErr);
    if (existing) return { kind: "sent" };

    // 4. 写真の記録（枚数・撮影時間のチェックはデータベース側で行われる）
    let { error: insErr } = await withTimeout(
      Promise.resolve(
        supabase.from("photos").insert({ event_id: shot.eventId, guest_id: shot.guestId, storage_path: path, thumb_path: thumbPath }),
      ),
      20_000,
    );
    // DB にまだ thumb_path 列が無い（002_thumbnails.sql 未実行）場合は、サムネイル無しで保存する
    if (insErr && thumbPath && /thumb_path/.test(insErr.message)) {
      ({ error: insErr } = await withTimeout(
        Promise.resolve(supabase.from("photos").insert({ event_id: shot.eventId, guest_id: shot.guestId, storage_path: path })),
        20_000,
      ));
      if (!insErr) await bucket.remove([thumbPath]).catch(() => {});
    }
    // 打ち切った通信が実は届いていて、記録がもうある場合（同じファイル名は1つしか記録できない）
    if (insErr && (insErr.code === "23505" || /duplicate key/i.test(insErr.message))) return { kind: "sent" };
    if (insErr) return fail(insErr);
    return { kind: "sent" };
  } catch (e) {
    return fail(e);
  }
}
