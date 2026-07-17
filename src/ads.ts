// 広告の幕間スロット（13_リッチ化設計書.md §7 の布石）。
// いまは enabled=false で常に素通り。広告を導入する時は
// @capacitor-community/admob を入れて maybeShowInterstitial の中身を実装するだけで、
// 完走→リザルトの間に達成後インタースティシャルが差し込まれる。
// 頻度・猶予の方針は先に定数として固定しておく（後から「出しすぎ」にならないための自制装置）。

export const AD_CONFIG = {
  enabled: false,        // 広告導入時にtrue（プライバシーポリシー改訂・ATT対応とセットで）
  minHoursBetween: 20,   // 達成後広告は最短でも20時間に1回
  graceDays: 7,          // 初回起動からの猶予期間は表示しない（習慣化が先）
};

const LAST_SHOWN_KEY = "ninjahiit_ad_last_shown";
const FIRST_LAUNCH_KEY = "ninjahiit_first_launch";

export function recordFirstLaunch() {
  if (typeof localStorage === "undefined") return;
  if (!localStorage.getItem(FIRST_LAUNCH_KEY)) {
    localStorage.setItem(FIRST_LAUNCH_KEY, String(Date.now()));
  }
}

// 表示してよいタイミングかの判定（広告SDK導入前から仕様を固定しておく）
export function interstitialAllowed(now = Date.now()): boolean {
  if (!AD_CONFIG.enabled) return false;
  if (typeof localStorage === "undefined") return false;
  const first = Number(localStorage.getItem(FIRST_LAUNCH_KEY) || now);
  if (now - first < AD_CONFIG.graceDays * 86400000) return false;
  const last = Number(localStorage.getItem(LAST_SHOWN_KEY) || 0);
  return now - last >= AD_CONFIG.minHoursBetween * 3600000;
}

export async function maybeShowInterstitial(): Promise<void> {
  if (!interstitialAllowed()) return;
  // TODO(広告導入時): AdMobのインタースティシャルを表示し、閉じられるまでawaitする。
  // 表示に成功したら localStorage.setItem(LAST_SHOWN_KEY, String(Date.now()))
}
