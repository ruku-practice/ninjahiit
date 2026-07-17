// Supabaseクライアント（R2: 匿名認証＋クラウド保存。13_リッチ化設計書.md §3）
// - supabase-jsは動的importで遅延ロード（起動速度を守る。バンドルも別チャンクになる）
// - 初回は匿名サインインで自動的にアカウントが作られる（ユーザー操作ゼロ）
// - 失敗してもアプリはローカルで完全動作（ローカルファースト原則）。例外は外に投げない

import { SUPABASE, cloudEnabled } from "./config.ts";

let clientPromise: Promise<any> | null = null;

// クライアントを遅延生成（クラウド無効時はnull）
export function supabasePromise(): Promise<any> | null {
  if (!cloudEnabled()) return null;
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js")
      .then(({ createClient }) => createClient(SUPABASE.url, SUPABASE.anonKey));
  }
  return clientPromise;
}

// サインイン済みのuser_idを返す。セッションが無ければ匿名サインインを試みる。
// （匿名サインインはSupabase側で Authentication → Sign In / Up → Anonymous sign-ins を有効にする必要あり）
export async function ensureSignedIn(): Promise<string | null> {
  const p = supabasePromise();
  if (!p) return null;
  try {
    const sb = await p;
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user?.id) return session.user.id;
    const { data, error } = await sb.auth.signInAnonymously();
    if (error) return null; // 無効・オフライン等。次回また試す
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}
