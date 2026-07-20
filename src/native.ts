// ネイティブ(Capacitor)連携層。Webブラウザでは全メソッドが安全にno-opになる。
// プラグイン: LocalNotifications / Preferences / Haptics / KeepAwake（native/package.json）

import { authStorageKey } from "./config.ts";

declare global {
  interface Window { Capacitor?: any }
}

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
  // 毎回「次の1回」だけを予約し、起動時と完走時に予約し直す（repeat管理より確実）
  REMINDER_ID: 1,
  REMINDER_MSGS: [
    "今日の4分、いっしょにやろ？",
    "4分だけ、忍んでいこ！",
    "サクヤ、待ってるよ 🥷",
    "今日も少しだけ、前へ。4分いこ！",
  ],
  // 連続記録があるときの文面（Duolingo研究より：キャラ名義＋状況文面。ただし脅さない）
  STREAK_MSGS: [
    "連続{n}日目。今日の4分、守りにいこ！",
    "{n}日続いてるよ。すごいことだよ、今日も少しだけ！",
    "サクヤと{n}日連続修行中。今日もいける？",
  ],
  async syncReminder(timeHHMM, doneToday, streak = 0) {
    const ln = this.plugin("LocalNotifications");
    if (!ln) return "web";
    try {
      await ln.cancel({ notifications: [{ id: this.REMINDER_ID }] });
      if (!timeHHMM) return "off";
      const perm = await ln.requestPermissions();
      if (!perm || perm.display !== "granted") return "denied";
      const [h, m] = timeHHMM.split(":").map(Number);
      const at = new Date();
      at.setHours(h, m, 0, 0);
      if (at.getTime() <= Date.now() || doneToday) at.setDate(at.getDate() + 1); // 過ぎた or 今日は完走済み→明日
      const pool = streak >= 2 ? this.STREAK_MSGS : this.REMINDER_MSGS;
      const body = pool[Math.floor(Math.random() * pool.length)].replace("{n}", String(streak));
      await ln.schedule({ notifications: [{
        id: this.REMINDER_ID,
        title: "サクヤと毎日筋トレ",
        body,
        schedule: { at, allowWhileIdle: true },
      }] });
      return "scheduled";
    } catch (e) { return "error"; }
  },
};
