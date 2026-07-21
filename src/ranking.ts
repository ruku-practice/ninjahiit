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
  ninja_id: string; // 忍びコード（user基準の安定ID。schema_v4_social_fixes.sql適用後に付与される）
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

// ---- 忍び名の非表示（ローカルのみ・改名しても効くよう ninja_id 基準）----
// 運営宛の通報導線はプライバシーポリシーの窓口に委ね、ここは「自分の画面からだけ隠す」
// ミュート相当の最小構成。Nodeでのユニットテスト用に localStorage が無い環境はメモリにフォールバック
// （points.ts/sync.tsと同じ hasLS パターン）
export interface HiddenNinja { id: string; name: string; hiddenAt: number }

const HIDDEN_KEY = "ninjahiit_hidden_ninjas";
const hasLS = typeof localStorage !== "undefined";
const mem: { v?: string } = {};

function readHidden(): HiddenNinja[] {
  try {
    const raw = hasLS ? localStorage.getItem(HIDDEN_KEY) : mem.v;
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function writeHidden(list: HiddenNinja[]): void {
  const s = JSON.stringify(list);
  if (hasLS) localStorage.setItem(HIDDEN_KEY, s); else mem.v = s;
}

// 現在の非表示リスト（マイページの「非表示にした人」一覧・番付フィルタの両方から使う）
export function hiddenNinjas(): HiddenNinja[] {
  return readHidden();
}

// 非表示に追加（同一idは重複させない）
export function hideNinja(id: string, name: string): HiddenNinja[] {
  if (!id) return readHidden();
  const list = readHidden();
  if (list.some((h) => h.id === id)) return list;
  const next = [...list, { id, name, hiddenAt: Date.now() }];
  writeHidden(next);
  return next;
}

// 非表示を解除（マイページの「戻す」用）
export function unhideNinja(id: string): HiddenNinja[] {
  const next = readHidden().filter((h) => h.id !== id);
  writeHidden(next);
  return next;
}

// 番付から非表示リストの人を除外する純粋関数。自分の行は誤操作防止のため常に残す
export function filterHiddenRanking(rows: RankRow[], hidden: HiddenNinja[]): RankRow[] {
  if (!hidden.length) return rows;
  const ids = new Set(hidden.map((h) => h.id));
  return rows.filter((r) => r.is_me || !ids.has(r.ninja_id));
}
