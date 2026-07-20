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

// ---- Google任意連携（PWA/Web専用。ネイティブでは呼ばない） ----
// 匿名サインインで作られたuser_idを維持したままGoogleを紐づけられるので、
// 連続日数・修行値・なかまコード等は別途の移行処理なしでそのまま引き継がれる。

// 戻り先URL（Supabase側の Authentication → URL Configuration → Redirect URLs 許可リストに
// 同じ値を登録しておく必要がある。例: 本番 https://rukupractice.com/kintore/ 、
// 開発 http://localhost:5199/ ）
function redirectPath(): string {
  return location.origin + location.pathname;
}

// このページ読み込みがOAuthリダイレクトからの復帰かどうか（純粋関数・テスト可能）
// supabase-jsのdetectSessionInUrl（既定ON）が code=(PKCE) / access_token=(implicit) / error= を
// URLから拾ってセッションを確立する。呼び出し側はこの判定でクラウド同期・画面復帰を早める。
export function isOAuthReturnUrl(search: string, hash: string): boolean {
  return /[?&#](code|access_token|error)=/.test(`${search}${hash}`);
}

export interface IdentityStatus {
  linked: boolean;
  email: string | null;
}

// 現在のセッションにGoogle identityが紐づいているか。未サインイン・オフライン等は linked:false
export async function getIdentityStatus(): Promise<IdentityStatus> {
  const p = supabasePromise();
  if (!p) return { linked: false, email: null };
  try {
    const sb = await p;
    const { data, error } = await sb.auth.getUserIdentities();
    if (error || !data) return { linked: false, email: null };
    const google = data.identities?.find((i: any) => i.provider === "google");
    return { linked: !!google, email: google?.identity_data?.email ?? null };
  } catch {
    return { linked: false, email: null };
  }
}

// 今の匿名アカウントにGoogleを紐づける（データはそのままuser_idに残る）。
// 成功するとページ全体がGoogleへリダイレクトされるのでここでは戻ってこない。
// 失敗（プロバイダ未設定・オフライン等）はリダイレクトせずfalseを返す
export async function linkGoogle(): Promise<boolean> {
  const p = supabasePromise();
  if (!p) return false;
  try {
    const sb = await p;
    const { error } = await sb.auth.linkIdentity({
      provider: "google",
      options: { redirectTo: redirectPath() },
    });
    return !error;
  } catch {
    return false;
  }
}

// 別端末で既存の連携済みアカウントへサインインし直す用（機種変更・再インストール後）。
// 実行前に呼び出し側で「この端末の未同期データが置き換わり得る」確認を取ること
export async function signInWithGoogle(): Promise<boolean> {
  const p = supabasePromise();
  if (!p) return false;
  try {
    const sb = await p;
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectPath() },
    });
    return !error;
  } catch {
    return false;
  }
}
