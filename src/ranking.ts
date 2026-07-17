// 週間ランキング（R3。13_リッチ化設計書.md §4）
// サーバー側は supabase/schema.sql の weekly_ranking RPC。
// 掲載条件=忍び名を設定していること（実名・Apple名は一切使わない）。
// クラウド無効・オフライン時は null を返し、画面側で案内を出す。

import { cloudEnabled } from "./config.ts";
import { ensureSignedIn, supabasePromise } from "./cloud.ts";

export interface RankRow {
  rank: number;
  ninja_name: string;
  weekly_exp: number;
  is_me: boolean;
}

// 忍び名の簡易バリデーション（設計書§4: NGワードフィルタのみ・重複OK）
const NG_WORDS = [
  "うんこ", "ちんこ", "まんこ", "きんたま", "せっくす", "セックス",
  "死ね", "しね", "殺す", "ころす", "fuck", "sex", "shit", "penis",
];
export function validateNinjaName(name: string): "ok" | "empty" | "too_long" | "ng_word" {
  const n = name.trim();
  if (!n) return "empty";
  if ([...n].length > 12) return "too_long"; // DB上限20だがUIは12文字まで
  const lower = n.toLowerCase();
  if (NG_WORDS.some((w) => lower.includes(w))) return "ng_word";
  return "ok";
}

// 自分の忍び名を取得（未設定・未サインイン・オフラインは ""）
export async function getNinjaName(): Promise<string> {
  if (!cloudEnabled()) return "";
  try {
    const uid = await ensureSignedIn();
    if (!uid) return "";
    const sb = await supabasePromise();
    const { data } = await sb.from("profiles").select("ninja_name").eq("id", uid).maybeSingle();
    return data?.ninja_name || "";
  } catch { return ""; }
}

// 忍び名を設定（ランキング参加）。空文字でランキングから退出
export async function setNinjaName(name: string): Promise<boolean> {
  if (!cloudEnabled()) return false;
  try {
    const uid = await ensureSignedIn();
    if (!uid) return false;
    const sb = await supabasePromise();
    const { error } = await sb.from("profiles")
      .upsert({ id: uid, ninja_name: name.trim(), updated_at: new Date().toISOString() });
    return !error;
  } catch { return false; }
}

// 今週のランキング上位を取得（失敗時 null）
export async function fetchWeeklyRanking(): Promise<RankRow[] | null> {
  if (!cloudEnabled()) return null;
  try {
    const uid = await ensureSignedIn();
    if (!uid) return null;
    const sb = await supabasePromise();
    const { data, error } = await sb.rpc("weekly_ranking", { limit_n: 100 });
    if (error) return null;
    return data as RankRow[];
  } catch { return null; }
}
