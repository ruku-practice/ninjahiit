// クラウド同期の骨組み（13_リッチ化設計書.md §3、R2で完成させる）。
// 完走履歴(history)は追記専用なので、「何件目まで送ったか」のカーソル1個だけで差分同期できる。
// オフラインでも動作は変わらず、送信はバックグラウンドのベストエフォート。
//
// R2でやること:
//   1. Supabaseプロジェクト作成（ルク）→ config.ts にURL/anonKey記入
//   2. npm i @supabase/supabase-js → 匿名サインイン→(任意)Apple昇格
//   3. pushPending 内で results テーブルへ upsert（onConflict: "user_id,client_ts" で冪等）

import { cloudEnabled } from "./config.ts";

const CURSOR_KEY = "ninjahiit_sync_cursor";

// Nodeテスト用フォールバック
const mem: Record<string, string> = {};
const hasLS = typeof localStorage !== "undefined";
const getRaw = (k: string) => (hasLS ? localStorage.getItem(k) : mem[k] ?? null);
const setRaw = (k: string, v: string) => { if (hasLS) localStorage.setItem(k, v); else mem[k] = v; };

export function syncCursor(): number {
  return Number(getRaw(CURSOR_KEY) || 0);
}

export function setSyncCursor(n: number) {
  setRaw(CURSOR_KEY, String(n));
}

// まだクラウドに送っていない完走履歴（history全体を渡す）
export function pendingResults<T>(history: T[]): T[] {
  return history.slice(syncCursor());
}

// 未送信分をクラウドへ送る。成功した件数だけカーソルを進める。失敗しても例外は投げない
export async function pushPending<T>(history: T[]): Promise<number> {
  if (!cloudEnabled()) return 0;
  const pending = pendingResults(history);
  if (!pending.length) return 0;
  try {
    // TODO(R2): supabase.from("results").upsert(...) → 成功時のみ:
    // setSyncCursor(history.length);
    return 0;
  } catch {
    return 0; // オフライン等は次回の完走時に再試行される
  }
}
