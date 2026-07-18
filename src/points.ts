// 小判（ポイント）台帳 — append-only。残高カラムは持たず、常に台帳の合計から導出する。
// 将来のリワード広告(reward_ad)・アプリ内課金(iap)・キャラ解放(unlock)も、
// source の種類が増えるだけでテーブル構造は変わらない（13_リッチ化設計書.md §5）。
// クラウド同期時はこの台帳をそのままSupabaseの point_ledger へ差分アップロードする。

export type KobanSource =
  | "workout"     // 完走
  | "mission"     // 今日の任務クリア
  | "week_goal"   // 週目標(3日)達成
  | "reward_ad"   // (将来) リワード広告視聴
  | "iap"         // (将来) 購入
  | "unlock"      // (将来) キャラ・衣装の解放（マイナス）
  | "adjust";     // 運営調整・不正補正

export interface KobanEntry {
  delta: number;        // +獲得 / -消費
  source: KobanSource;
  ref?: string;         // 参照（完走ts・広告トランザクションID等）
  at: number;           // epoch ms
}

// 獲得レート（仮確定 2026-07-14。ルク調整可）
export const KOBAN_RATES = { workout: 10, mission: 5, weekGoal: 20, perfectWeek: 50, shieldCost: 100 } as const;
export const SHIELD_MAX = 2; // お守りの所持上限

const KEY = "ninjahiit_koban_ledger";

// Nodeでのユニットテスト用に localStorage が無い環境ではメモリにフォールバック
const mem: Record<string, string> = {};
const hasLS = typeof localStorage !== "undefined";
const read = (): KobanEntry[] => {
  try { return JSON.parse((hasLS ? localStorage.getItem(KEY) : mem[KEY]) || "[]"); }
  catch { return []; }
};
const write = (list: KobanEntry[]) => {
  const s = JSON.stringify(list);
  if (hasLS) localStorage.setItem(KEY, s); else mem[KEY] = s;
};

export function kobanLedger(): KobanEntry[] {
  return read();
}

export function addKoban(delta: number, source: KobanSource, ref?: string): KobanEntry {
  const entry: KobanEntry = { delta, source, at: Date.now() };
  if (ref) entry.ref = ref;
  const list = read();
  list.push(entry);
  write(list);
  return entry;
}

export function kobanBalance(): number {
  return read().reduce((a, e) => a + e.delta, 0);
}

// テスト・デバッグ用（本番UIからは呼ばない）
export function _resetKobanForTest() {
  write([]);
}
