// ネイティブ(Capacitor)連携層。Webブラウザでは全メソッドが安全にno-opになる。
// プラグイン: LocalNotifications / Preferences / Haptics / KeepAwake（native/package.json）

import { authStorageKey } from "./config.ts";

declare global {
  interface Window { Capacitor?: any }
}

// リマインダー文面（単一ソース。Native.syncReminderとbuildReminderPlanの両方がここを参照する）
export const REMINDER_MSGS = [
  "今日の4分、いっしょにやろ？",
  "4分だけ、忍んでいこ！",
  "サクヤ、待ってるよ 🥷",
  "今日も少しだけ、前へ。4分いこ！",
];
// 連続記録があるときの文面（Duolingo研究より：キャラ名義＋状況文面。ただし脅さない）
export const STREAK_MSGS = [
  "連続{n}日目。今日の4分、守りにいこ！",
  "{n}日続いてるよ。すごいことだよ、今日も少しだけ！",
  "サクヤと{n}日連続修行中。今日もいける？",
];

export const Native: any = {
  get isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  },
  plugin(name) {
    return this.isNative && window.Capacitor.Plugins ? window.Capacitor.Plugins[name] : null;
  },

  // ---- ハプティクス（3・2・1カウント/完走） ----
  async tick() {
    const h = this.plugin("Haptics");
    if (h) try { await h.impact({ style: "LIGHT" }); } catch (e) {}
  },
  async finishBuzz() {
    const h = this.plugin("Haptics");
    if (h) try { await h.notification({ type: "SUCCESS" }); } catch (e) {}
  },

  // ---- 画面スリープ防止（WebのWakeLock APIと併用） ----
  async keepAwake(on) {
    const k = this.plugin("KeepAwake");
    if (k) try { on ? await k.keepAwake() : await k.allowSleep(); } catch (e) {}
  },

  // ---- 記録のバックアップ（WKWebViewのlocalStorage消失対策） ----
  // localStorageを正としつつ、完走のたびにPreferencesへ複製。起動時に空なら復元。
  async backup() {
    const p = this.plugin("Preferences");
    if (!p) return;
    try {
      await p.set({ key: "backup_v1", value: JSON.stringify({
        history: localStorage.getItem("ninjahiit_history"),
        settings: localStorage.getItem("ninjahiit_settings"),
        koban: localStorage.getItem("ninjahiit_koban_ledger"),
        syncCursor: localStorage.getItem("ninjahiit_sync_cursor"),
        ledgerCursor: localStorage.getItem("ninjahiit_ledger_cursor"),
        auth: localStorage.getItem(authStorageKey()),   // 匿名アカウントのセッション（消えると別人になってしまう）
        at: Date.now(),
      }) });
    } catch (e) {}
  },
  async restoreIfEmpty() {
    const p = this.plugin("Preferences");
    if (!p) return false;
    if (localStorage.getItem("ninjahiit_history")) return false; // 生きているなら触らない
    try {
      const r = await p.get({ key: "backup_v1" });
      if (!r || !r.value) return false;
      const d = JSON.parse(r.value);
      if (d.history) localStorage.setItem("ninjahiit_history", d.history);
      if (d.settings) localStorage.setItem("ninjahiit_settings", d.settings);
      if (d.koban) localStorage.setItem("ninjahiit_koban_ledger", d.koban);
      if (d.syncCursor) localStorage.setItem("ninjahiit_sync_cursor", d.syncCursor);
      if (d.ledgerCursor) localStorage.setItem("ninjahiit_ledger_cursor", d.ledgerCursor);
      if (d.auth) localStorage.setItem(authStorageKey(), d.auth);
      return !!d.history;
    } catch (e) { return false; }
  },

  // ---- オーディオセッション（iOSのみ。AudioSessionBridgeカスタムプラグイン） ----
  // 対象はアプリ本体プロセスのセッションのみ。WKWebViewの中身は別プロセス（WebContent）で動き
  // 独自のセッションを持つため、Web Audio（声・SE）のマナーモード挙動はここからは変えられない
  // （2026-07-23実機で確認済み。詳細は AudioSessionBridge.swift の冒頭コメント）。
  // 読み取り専用（表示・切り分け用）。セッションには触れないので再生に割り込まない
  async audioState() {
    const a = this.plugin("AudioSessionBridge");
    if (!a) return null;
    try { return await a.getState(); } catch (e) { return null; }
  },

  async applyAudioMix() {
    const a = this.plugin("AudioSessionBridge");
    if (!a) return null;
    try { return await a.applyMixWithOthers(); } catch (e) { return null; }
  },

  // ---- BGM（iOSはネイティブ再生。ブラウザ/PWAはWeb側の<audio>にフォールバック）----
  // WKWebViewの<audio>はWebKitが「このアプリの音楽再生」としてOSに登録してしまい、
  // 他アプリの中断・Now Playingへの露出・マナーモードの食い違いが起きる。抑止不能なので
  // ネイティブでは<audio>を使わずAVAudioPlayerへ委譲する。hasBgm=false なら従来経路。
  get hasBgm() { return !!this.plugin("AudioSessionBridge"); },
  async bgmPlay(track: string, volume: number) {
    const a = this.plugin("AudioSessionBridge");
    if (!a) return false;
    try { await a.playBgm({ track, volume }); return true; } catch (e) { return false; }
  },
  async bgmStop() {
    const a = this.plugin("AudioSessionBridge");
    if (a) try { await a.stopBgm(); } catch (e) {}
  },
  async bgmPause() {
    const a = this.plugin("AudioSessionBridge");
    if (a) try { await a.pauseBgm(); } catch (e) {}
  },
  async bgmResume() {
    const a = this.plugin("AudioSessionBridge");
    if (a) try { await a.resumeBgm(); } catch (e) {}
  },
  async bgmVolume(volume: number, fadeMs: number) {
    const a = this.plugin("AudioSessionBridge");
    if (a) try { await a.setBgmVolume({ volume, fadeMs }); } catch (e) {}
  },

  // ---- 声と効果音（iOSはネイティブ再生。ブラウザ/PWAはWeb Audioにフォールバック）----
  // Web Audioはマナーモードで黙る（WebContentプロセスのセッションが .ambient になるため。
  // アプリ側からは変えられないことを実機で確認済み）。声はこの製品の主役なので移設した。
  // playVoice の戻り値 duration は、BGMのダッキング時間に使う
  async voicePlay(name: string, dir: string, volume: number, interrupt: boolean) {
    const a = this.plugin("AudioSessionBridge");
    if (!a) return null;
    try { return await a.playVoice({ name, dir, volume, interrupt }); } catch (e) { return null; }
  },
  async voiceStop() {
    const a = this.plugin("AudioSessionBridge");
    if (a) try { await a.stopVoice(); } catch (e) {}
  },
  async sePlay(name: string) {
    const a = this.plugin("AudioSessionBridge");
    if (a) try { await a.playSe({ name }); } catch (e) {}
  },

  // ---- ホーム画面ウィジェット連携（iOSのみ。WidgetBridgeカスタムプラグイン） ----
  // streak等をApp Group経由でウィジェットに渡し、タイムラインを更新させる
  // weekDone: 週間実施ドット（月〜日7要素・任意）。SakuyaWidget.swiftのparseWeekDone()が
  // 受理する「カンマ区切り "1,0,1,..."」に変換して渡す。未指定でも従来どおり動く（前方互換）。
  async updateWidget(info: { streak: number; doneToday: boolean; mission: string; koban: number; date: string; weekDone?: boolean[] }) {
    const w = this.plugin("WidgetBridge");
    if (!w) return;
    const { weekDone, ...rest } = info;
    const payload: any = { ...rest };
    if (weekDone && weekDone.length === 7) {
      payload.weekDone = weekDone.map((d) => (d ? "1" : "0")).join(",");
    }
    try { await w.saveState(payload); } catch (e) {}
  },

  // ---- リマインダー通知（罰しない設計：完走した日はその日の通知を出さない） ----
  // 修正前バグ(2026-07-12〜既知): `at`で「次の1回」だけを単発予約し、起動時と完走時に
  // 予約し直す設計だったため、数日アプリを開かないと予約が尽きて通知が完全に止まっていた
  // （「毎日」と謳いながら実際は毎日ではなかった）。
  // 修正: buildReminderPlan()でこれから REMINDER_DAYS_AHEAD 日分をまとめて予約する。
  // アプリを開く頻度が落ちても、直近の来訪時点から既に2週間分が積まれているため
  // 通知が完全に途切れることはない（「毎日繰り返し」の実質を満たす）。
  // 完走日スキップ（今日はもう完走済みなら今日の分だけ出さない）は buildReminderPlan 側で維持。
  REMINDER_ID: 1,          // 旧バージョン（単発予約）の予約ID。移行時の掃除用に残す
  REMINDER_BASE_ID: 1000,  // 新方式：REMINDER_BASE_ID + dayOffset を予約IDにする
  REMINDER_DAYS_AHEAD: 14,
  async syncReminder(timeHHMM, doneToday, streak = 0) {
    const ln = this.plugin("LocalNotifications");
    if (!ln) return "web";
    try {
      // 直近の予約をすべて取り消してから、これから14日分を作り直す
      // （旧バージョンのREMINDER_ID単発予約が残っていても一緒に掃除する）
      const cancelIds = [{ id: this.REMINDER_ID },
        ...Array.from({ length: this.REMINDER_DAYS_AHEAD }, (_, i) => ({ id: this.REMINDER_BASE_ID + i }))];
      await ln.cancel({ notifications: cancelIds });
      if (!timeHHMM) return "off";
      const perm = await ln.requestPermissions();
      if (!perm || perm.display !== "granted") return "denied";
      const plan = buildReminderPlan(timeHHMM, doneToday, streak, new Date(), this.REMINDER_DAYS_AHEAD, this.REMINDER_BASE_ID);
      if (!plan.length) return "off"; // 今日はもう完走済み＆明日以降の枠も無い等（daysAheadを極端に小さくした場合のみ）
      await ln.schedule({ notifications: plan.map((p) => ({
        id: p.id,
        title: "サクヤと4分筋トレ",
        body: p.body,
        schedule: { at: p.at, allowWhileIdle: true },
      })) });
      return "scheduled";
    } catch (e) { return "error"; }
  },
};

// ---- リマインダー予約プラン（純粋関数・テスト用） ----
// timeHHMM: "HH:MM"（空文字ならoff）。doneToday: 今日は完走済みか（今日分だけスキップ）。
// streak: 連続日数（2日以上でSTREAK_MSGSを使う）。now: 基準時刻（省略時は現在時刻・テストで注入）。
// daysAhead: 何日分先まで一度に予約するか。baseId: 予約IDの起点（id = baseId + dayOffset）。
export interface ReminderPlanItem { id: number; at: Date; body: string }
export function buildReminderPlan(
  timeHHMM: string,
  doneToday: boolean,
  streak: number = 0,
  now: Date = new Date(),
  daysAhead: number = 14,
  baseId: number = 1000,
): ReminderPlanItem[] {
  if (!timeHHMM) return [];
  const [h, m] = timeHHMM.split(":").map(Number);
  const pool = streak >= 2 ? STREAK_MSGS : REMINDER_MSGS;
  const plan: ReminderPlanItem[] = [];
  for (let dayOffset = 0; dayOffset < daysAhead; dayOffset++) {
    const at = new Date(now);
    at.setDate(at.getDate() + dayOffset);
    at.setHours(h, m, 0, 0);
    if (dayOffset === 0) {
      if (at.getTime() <= now.getTime()) continue; // 今日の時刻はもう過ぎている
      if (doneToday) continue;                      // 罰しない設計：完走済みの今日はスキップ
    }
    const body = pool[Math.floor(Math.random() * pool.length)].replace("{n}", String(streak));
    plan.push({ id: baseId + dayOffset, at, body });
  }
  return plan;
}
