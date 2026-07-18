// なかま（友達）＆つつき（手裏剣）— 15_習慣化ラボ_Duolingo研究.md
// サーバー側は supabase/schema_v2.sql（friend_code / friends / pokes ＋ RPC群）。
// Duolingoのナッジ同様、送る文面はアプリが用意した応援メッセージから選ぶだけ
// （自由入力なし＝モデレーション不要・審査も安全）。

import { cloudEnabled } from "./config.ts";
import { ensureSignedIn, supabasePromise } from "./cloud.ts";

export const POKE_MESSAGES = [
  "今日の4分、一緒にどう？",
  "先にやっておいたよ。次はきみの番！",
  "無理せず、でも今日もいこ！",
];

export interface FriendRow {
  friend_id: string;
  ninja_name: string;
  weekly_exp: number;
  done_today: boolean;
}

export interface PokeRow {
  poke_id: number;
  from_name: string;
  msg_idx: number;
  created_at: string;
}

// プロフィール行が無いと忍びコードも無いので、先に空プロフィールを確保する
async function ensureProfileRow(sb: any, uid: string) {
  await sb.from("profiles").upsert({ id: uid }, { onConflict: "id", ignoreDuplicates: true });
}

// 自分の忍びコード（6文字）。未サインイン・オフラインは ""
export async function myFriendCode(): Promise<string> {
  if (!cloudEnabled()) return "";
  try {
    const uid = await ensureSignedIn();
    if (!uid) return "";
    const sb = await supabasePromise();
    await ensureProfileRow(sb, uid);
    const { data } = await sb.from("profiles").select("friend_code").eq("id", uid).maybeSingle();
    return data?.friend_code || "";
  } catch { return ""; }
}

export async function addFriendByCode(code: string): Promise<{ ok: boolean; name: string }> {
  if (!cloudEnabled()) return { ok: false, name: "" };
  try {
    const uid = await ensureSignedIn();
    if (!uid) return { ok: false, name: "" };
    const sb = await supabasePromise();
    const { data, error } = await sb.rpc("add_friend_by_code", { code });
    if (error || !data?.length) return { ok: false, name: "" };
    return { ok: !!data[0].ok, name: data[0].friend_name || "" };
  } catch { return { ok: false, name: "" }; }
}

export async function friendsBoard(): Promise<FriendRow[] | null> {
  if (!cloudEnabled()) return null;
  try {
    const uid = await ensureSignedIn();
    if (!uid) return null;
    const sb = await supabasePromise();
    const { data, error } = await sb.rpc("friends_board");
    if (error) return null;
    return data as FriendRow[];
  } catch { return null; }
}

// 'ok' | 'not_friend' | 'already_today' | 'error'
export async function sendPoke(friendId: string, msgIdx: number): Promise<string> {
  if (!cloudEnabled()) return "error";
  try {
    const uid = await ensureSignedIn();
    if (!uid) return "error";
    const sb = await supabasePromise();
    const { data, error } = await sb.rpc("send_poke", { target: friendId, msg: msgIdx });
    return error ? "error" : (data as string);
  } catch { return "error"; }
}

export async function fetchUnseenPokes(): Promise<PokeRow[]> {
  if (!cloudEnabled()) return [];
  try {
    const uid = await ensureSignedIn();
    if (!uid) return [];
    const sb = await supabasePromise();
    const { data, error } = await sb.rpc("unseen_pokes");
    return error ? [] : (data as PokeRow[]);
  } catch { return []; }
}

export async function markPokesSeen(ids: number[]): Promise<void> {
  if (!cloudEnabled() || !ids.length) return;
  try {
    const sb = await supabasePromise();
    await sb.from("pokes").update({ seen: true }).in("id", ids);
  } catch { /* 次回また出るだけ */ }
}
