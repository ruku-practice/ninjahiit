// クラウド同期（R2実装済み。13_リッチ化設計書.md §3）
// 完走履歴(history)と小判台帳(ledger)は追記専用なので、
// 「何件目まで送ったか」のカーソルだけで差分同期できる。
// 送信は冪等アップサート（主キー衝突は無視）なので二重送信しても壊れない。
// オフライン・未サインイン・テーブル未作成でも失敗は握りつぶし、次の完走時に再試行される。

import { cloudEnabled } from "./config.ts";
import { ensureSignedIn, supabasePromise } from "./cloud.ts";
import { kobanLedger } from "./points.ts";

const CURSOR_KEY = "ninjahiit_sync_cursor";          // resultsの送信済み件数
const LEDGER_CURSOR_KEY = "ninjahiit_ledger_cursor"; // point_ledgerの送信済み件数

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
export function ledgerCursor(): number {
  return Number(getRaw(LEDGER_CURSOR_KEY) || 0);
}
export function setLedgerCursor(n: number) {
  setRaw(LEDGER_CURSOR_KEY, String(n));
}

// まだクラウドに送っていない完走履歴（history全体を渡す）
export function pendingResults<T>(history: T[]): T[] {
  return history.slice(syncCursor());
}

// 未送信分をクラウドへ送る。成功した分だけカーソルを進める。例外は投げない
export async function syncNow(history: any[]): Promise<void> {
  if (!cloudEnabled()) return;
  try {
    const uid = await ensureSignedIn();
    if (!uid) return;
    const sb = await supabasePromise();

    // 1) 完走履歴 → results（(user_id, client_ts) で冪等）
    const pending = pendingResults(history);
    if (pending.length) {
      const rows = pending.map((h) => ({
        user_id: uid,
        client_ts: h.ts,
        date: h.date,
        workout_id: h.workoutId,
        total_work_sec: h.totalWorkSec,
        bonus_exp: h.bonusExp || 0,
      }));
      const { error } = await sb.from("results")
        .upsert(rows, { onConflict: "user_id,client_ts", ignoreDuplicates: true });
      if (!error) setSyncCursor(history.length);
    }

    // 2) 小判台帳 → point_ledger（(user_id, client_seq) で冪等。client_seq=台帳内の位置）
    const ledger = kobanLedger();
    const from = ledgerCursor();
    if (ledger.length > from) {
      const rows = ledger.slice(from).map((e, i) => ({
        user_id: uid,
        client_seq: from + i,
        delta: e.delta,
        source: e.source,
        ref: e.ref ?? null,
        client_at: e.at,
      }));
      const { error } = await sb.from("point_ledger")
        .upsert(rows, { onConflict: "user_id,client_seq", ignoreDuplicates: true });
      if (!error) setLedgerCursor(ledger.length);
    }
  } catch {
    /* オフライン等。次回の完走・起動時に再試行 */
  }
}
