"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/types";

export type TypedSupabaseClient = SupabaseClient<Database>;

let browserClient: TypedSupabaseClient | undefined;

/**
 * ブラウザ用 Supabase クライアント（シングルトン）。
 * セッションは @supabase/ssr によって Cookie に保存されるため、
 * サーバーコンポーネント（lib/supabase/server.ts）からも同じユーザーとして読める。
 */
export function getSupabaseBrowserClient(): TypedSupabaseClient {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // 新しい「Publishable key」と従来の「anon key」のどちらでも動くようにする
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase の環境変数が未設定です。.env.local に NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY（または NEXT_PUBLIC_SUPABASE_ANON_KEY）を設定してください。",
    );
  }

  browserClient = createBrowserClient<Database>(url, key);
  return browserClient;
}

/**
 * ログイン済みならそのユーザーを、未ログインなら匿名サインインして返す。
 * Supabase ダッシュボードで「Allow anonymous sign-ins」を ON にしておくこと。
 */
export async function ensureAnonymousUser(
  supabase: TypedSupabaseClient = getSupabaseBrowserClient(),
): Promise<User> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.user) return session.user;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    throw new Error(
      error?.message.includes("Anonymous sign-ins are disabled")
        ? "匿名ログインが無効です。Supabase の Authentication 設定で「Allow anonymous sign-ins」を ON にしてください。"
        : `ログインに失敗しました: ${error?.message ?? "unknown error"}`,
    );
  }
  return data.user;
}

/** 既存セッションがあればそのユーザーID、なければ null（サインインはしない） */
export async function getCurrentUserId(
  supabase: TypedSupabaseClient = getSupabaseBrowserClient(),
): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user.id ?? null;
}
