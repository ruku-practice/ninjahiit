// わいわいタウンSDK連携（PK-14セーブ保全・2026-08-05）
//
// わいわいタウン（waiwai.town）のiframe埋め込みプレイ（/play/ninja-hiit）では、
// Safari等のクロスサイトiframeストレージ分離により localStorage が一時領域扱いになり、
// 進捗・設定が消えることがある。SDK（https://waiwai.town/sdk.js）は
// わいわいタウン内では親ページのlocalStorageへ代理保存し、わいわいタウンの外
// （rukupractice.com直プレイ・単体テスト等）では自動で自分自身のlocalStorageへ
// フォールバックする（SDK仕様・window.parent===windowで即standalone確定）。
//
// 既存の localStorage 保存（app.ts の `store` 経由）は一切変更しない。
// ここはあくまで「保存のたびに同じ値をSDK側へもミラーし、ローカルが空のときだけ
// SDK側から復元する」追加のバックアップ層（Supabaseクラウド同期とは独立・後述）。
//
// 対象キー（store.set が呼ぶ非機密・非クラウド管理の進捗/設定のみ）:
//   settings / history / custom_menus / shields /
//   greeted_first / health_notice_ack / tutorial_prompt_ack
//
// 除外（Supabaseと二重管理になる、または機密情報のため対象外）:
//   - ninjahiit_koban_ledger（小判台帳）: sync.ts が ledgerCursor と一体で
//     Supabase の point_ledger へ差分アップロードする対象（points.ts冒頭コメント参照）。
//     SDK側からの復元とアップロード済みカーソルがズレる余地を作らないため対象外。
//   - ninjahiit_sync_cursor / ninjahiit_ledger_cursor: 上記と同じ理由（同期の
//     ブックキーピングそのもの）。
//   - Supabaseのセッション（config.ts の authStorageKey()）: 認証トークンであり
//     PK-14仕様が明記する「セーブに個人情報・秘密を入れない」に直接抵触する。
//     third-party origin（waiwai.town）へ中継すべきでない機密情報のため対象外。
//   （native.ts の Native.backup/restoreIfEmpty はこれらも含むが、あちらは
//   Capacitor Preferences経由でデバイス内に閉じたバックアップ＝信頼境界が異なる）

const MIRROR_KEYS = [
  "settings", "history", "custom_menus", "shields",
  "greeted_first", "health_notice_ack", "tutorial_prompt_ack",
] as const;
type MirrorKey = typeof MIRROR_KEYS[number];

function isMirrorKey(key: string): key is MirrorKey {
  return (MIRROR_KEYS as readonly string[]).includes(key);
}

declare global {
  interface Window {
    waiwai?: {
      save(key: string, data: unknown): Promise<void>;
      load(key: string): Promise<unknown>;
      delete(key: string): Promise<void>;
      ready: Promise<{ mode: "bridged" | "standalone" }>;
      mode: "pending" | "bridged" | "standalone";
    };
  }
}

let sdkPromise: Promise<boolean> | null = null;

// https://waiwai.town/sdk.js を1回だけ動的読み込みする。読み込み完了(window.waiwaiが
// 生える)まで待てるよう Promise<boolean> を返す（false=読み込み失敗/タイムアウト＝
// 呼び出し側は全部no-opにする。既存のlocalStorage保存には一切影響しない）。
function loadSdk(): Promise<boolean> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve) => {
    if (typeof document === "undefined") { resolve(false); return; }
    if (window.waiwai) { resolve(true); return; }
    try {
      const s = document.createElement("script");
      s.src = "https://waiwai.town/sdk.js";
      // 2026-08-05: crossorigin必須。COEP（クロスオリジン分離）環境ではCORSモードで
      // 読み込まないとブロックされる（かくれんぼのGodot PWAで実害・SW制御下のみ発症）。
      // 筋トレの現SWはCOEPを注入しないが、将来の変更で黙って壊れないよう予防で付ける。
      // waiwai.town側はACAO:*配信済みのため、COEP無し環境でも無害。
      s.crossOrigin = "anonymous";
      s.onload = () => resolve(!!window.waiwai);
      s.onerror = () => resolve(false); // CDN障害・オフライン等
      document.head.appendChild(s);
    } catch {
      resolve(false);
    }
    // sdk.js自体は数KBで即完了するはずだが、onload/onerrorどちらも来ない万一に備えた保険
    setTimeout(() => resolve(!!window.waiwai), 4000);
  });
  return sdkPromise;
}

// store.set() から呼ぶ。fire-and-forget（await しない前提）＝例外は投げない設計。
// ローカルのlocalStorage書き込みは呼び出し側が既に完了させてから呼ぶこと。
export async function mirrorToWaiwai(key: string, value: unknown): Promise<void> {
  if (!isMirrorKey(key)) return;
  const ok = await loadSdk();
  if (!ok || !window.waiwai) return;
  try {
    await window.waiwai.save(key, value);
  } catch {
    // 失敗（未接続・容量超過等）は握りつぶす。ローカル保存は既に成功済みなのでゲームは無傷。
  }
}

// リロード無限ループ防止（2026-08-27・実害バグ修正）：
// iOS Safari＋わいわいタウンiframe埋め込みでは、上部コメントのとおり localStorage が
// 「一時領域」扱いになり、setItem直後のlocation.reload()をまたいで値が残らないことがある。
// すると次のロードでも ninjahiit_history が空のまま→復元「成功」（history以外のどれか1キーが
// 復元できただけでも restored=true になる）→reload…を永久に繰り返し、画面がほぼ黒のまま
// 数秒おきに一瞬だけ描画がチラ見えする（実測: 2026-08-27カトスミさん報告）。
// sessionStorageは同一タブ内のreloadをまたいで確実に残る（クロスサイト遷移時に効く
// ストレージ分離とは別物・同一ブラウジングコンテキストが続く限り消えない）ため、
// 「このタブでは復元を試みた」の一回きりフラグに使い、2回目以降は無条件でスキップする。
const RESTORE_ATTEMPTED_KEY = "ninjahiit_waiwai_restore_attempted";

// 起動時に一度だけ呼ぶ。ninjahiit_history が既にローカルにあるなら何もしない
// （native.ts の Native.restoreIfEmpty と同じ「生きているなら触らない」方針）。
// 空のときだけ、わいわいSDK側の各キーから復元を試みる。1つでも復元できたキーが
// あれば true を返す（呼び出し側は location.reload() して素直に再起動する）。
export async function restoreFromWaiwaiIfEmpty(): Promise<boolean> {
  if (typeof localStorage === "undefined") return false;
  if (localStorage.getItem("ninjahiit_history")) return false;
  try {
    if (typeof sessionStorage !== "undefined") {
      if (sessionStorage.getItem(RESTORE_ATTEMPTED_KEY)) return false;
      sessionStorage.setItem(RESTORE_ATTEMPTED_KEY, "1");
    }
  } catch {
    // sessionStorageが使えない環境（プライベートモード等）はガード無しで1回だけ試みる
  }
  const ok = await loadSdk();
  if (!ok || !window.waiwai) return false;
  let restored = false;
  for (const key of MIRROR_KEYS) {
    try {
      const value = await window.waiwai.load(key);
      if (value !== null && value !== undefined) {
        localStorage.setItem("ninjahiit_" + key, JSON.stringify(value));
        restored = true;
      }
    } catch {
      // このキーだけ諦めて次へ（1キーの失敗で復元全体を止めない）
    }
  }
  return restored;
}
