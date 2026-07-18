// NinjaHIIT アプリ本体：画面管理・スプライト再生・記録

import {
  EXERCISES, PRESETS, TRAINERS, VOICE_LINES, voiceLineFirst, voiceLineNext,
  DEFAULT_SETTINGS, estimateKcal, expForResult, rankInfo, WEEKLY_GOAL,
  MISSION_BONUS_EXP, missionForDate, streakBonusExp, HOME_TAP_KEYS,
} from "./data.ts";
import { Sound, Voice } from "./audio.ts";
import { WorkoutEngine } from "./timer.ts";
import { Native } from "./native.ts";
import { KOBAN_RATES, SHIELD_MAX, addKoban, kobanBalance } from "./points.ts";
import { maybeShowInterstitial, recordFirstLaunch } from "./ads.ts";
import { syncNow } from "./sync.ts";
import { fetchWeeklyRanking, getNinjaName, setNinjaName, validateNinjaName } from "./ranking.ts";
import {
  POKE_MESSAGES, addFriendByCode, fetchUnseenPokes, friendsBoard, markPokesSeen, myFriendCode, sendPoke,
} from "./friends.ts";


const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem("ninjahiit_" + key)) ?? fallback; }
    catch { return fallback; }
  },
  set(key, value) { localStorage.setItem("ninjahiit_" + key, JSON.stringify(value)); },
};

interface HistoryEntry {
  date: string; workoutId: string; title: string;
  totalWorkSec: number; completed: boolean; ts: number; bonusExp?: number;
}
const state: {
  settings: any; history: HistoryEntry[]; engine: WorkoutEngine | null; wakeLock: any;
  missingImages: Set<string>;
  detailFrom?: string; currentWorkout?: any; lastMissionCleared?: boolean;
  lastFinishLine?: string | null; lastKobanEarned?: number;
  lastBonusExp?: number; lastStreakBonus?: number;
} = {
  // 既存ユーザーの保存値に新しい設定キー（plankSec等）のデフォルトを補う
  settings: { ...DEFAULT_SETTINGS, ...store.get("settings", {}) },
  history: store.get("history", []),
  engine: null,
  wakeLock: null,
  missingImages: new Set(),
};

const trainer = () => TRAINERS[state.settings.trainer];
const $ = (sel: string): any => document.querySelector(sel);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const quote = (key, vars = {}) =>
  pick(trainer().quotes[key]).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

// ---- 画面遷移 ----
function show(screenId) {
  document.querySelectorAll<any>(".screen").forEach(s => s.classList.remove("active"));
  $("#" + screenId).classList.add("active");
}

// ---- キャラ表示（PNGがあれば表示、なければ絵文字プレースホルダー） ----
function setCharaImage(el, src, fallbackLabel, frameIndex) {
  if (state.missingImages.has(src)) {
    renderPlaceholder(el, fallbackLabel, frameIndex);
    return;
  }
  let img = el.querySelector("img");
  if (!img) {
    el.innerHTML = "";
    img = document.createElement("img");
    img.alt = "";
    el.appendChild(img);
  }
  img.onerror = () => {
    state.missingImages.add(src);
    renderPlaceholder(el, fallbackLabel, frameIndex);
  };
  img.src = src;
}

function renderPlaceholder(el, label, frameIndex) {
  el.innerHTML =
    `<div class="chara-ph ${frameIndex % 2 ? "ph-f2" : "ph-f1"}">` +
    `<span class="ph-emoji">🥷</span><span class="ph-label">${label}</span></div>`;
}

// ---- お手本再生（ワークアウト実行画面のループ動画） ----
// video要素はコンテナごとに1つだけ作って使い回す（自動再生ポリシー対策：
// 開始タップで再生許可を得た要素なら、以後のsrc差し替え＋play()が許可される）
function playSprite(el, exerciseKey) {
  const src = `${trainer().videoDir}/${exerciseKey}.mp4`;
  let video = el.querySelector("video");
  if (!video) {
    el.innerHTML = "";
    video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    el.appendChild(video);
  }
  video.onerror = () => {
    // 一時的な読み込み失敗。この種目の間だけ静止画で代替し、次の種目では再び動画を試す
    // （以前は一度の失敗を恒久的に記録していて、以後ずっと動画が出なくなることがあった）
    el.innerHTML = `<img src="${trainer().thumbDir}/${exerciseKey}.jpg" alt="">`;
  };
  if (video.dataset.src !== src) {
    video.dataset.src = src;
    video.src = src;
    video.load(); // iOS WKWebView対策：src差し替え後はload()を明示
  }
  // src差し替え直後は読み込み中でplay()が拒否されるため、まず即時に試し、
  // 失敗したら再生可能になった時点でもう一度再生する
  const tryPlay = () => video.play().catch(() => {});
  tryPlay();
  video.addEventListener("canplay", tryPlay, { once: true });
}

function showPose(el, pose, label) {
  setCharaImage(el, `${trainer().dir}/${pose}.png`, label, 1);
}

// ---- ワークアウト一覧のサムネイル ----
// 一覧は静止画（動画から切り出した1コマ）で即表示し、タップした種目だけ
// お手本ループ動画を再生する（常に最大1本）。iOSはハードウェア動画デコーダの
// 同時使用数に上限があり、多数の<video>を並べると読み込みが詰まって
// 出たり出なかったりする不具合の原因になるため、一覧に動画は並べない。
let activeThumb = null; // 動画再生中のサムネ要素（常に最大1つ）

function startThumb(el, key) {
  el.innerHTML =
    `<img src="${trainer().thumbDir}/${key}.jpg" alt="">` +
    `<span class="thumb-play">▶</span>`;
  el.onclick = (e) => { e.stopPropagation(); toggleThumbVideo(el, key); };
}

function toggleThumbVideo(el, key) {
  const wasPlaying = activeThumb === el;
  stopThumbVideo();
  if (wasPlaying) return; // 再生中のサムネを再タップ→静止画に戻すだけ
  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.onerror = () => stopThumbVideo(); // 失敗したら静止画に戻す（失敗の記録はしない）
  el.appendChild(video);
  el.classList.add("playing");
  activeThumb = el;
  video.src = `${trainer().videoDir}/${key}.mp4`;
  video.load();
  const tryPlay = () => video.play().catch(() => {});
  tryPlay();
  video.addEventListener("canplay", tryPlay, { once: true });
}

function stopThumbVideo() {
  if (!activeThumb) return;
  const video = activeThumb.querySelector("video");
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load(); // ロード中断＋デコーダ解放
    video.remove();
  }
  activeThumb.classList.remove("playing");
  activeThumb = null;
}

function stopCatalog() {
  stopThumbVideo();
}

// ---- マイメニュー（カスタムワークアウト） ----
// 保存形式は PRESETS と同じ形＋ custom:true。IDは custom_<epoch>
const CUSTOM_LIMITS = { maxEx: 16, work: [5, 60], rest: [0, 60], rounds: [1, 3] };

function customMenus(): any[] {
  return store.get("custom_menus", []);
}
function saveCustomMenus(list: any[]) {
  store.set("custom_menus", list);
}
// プリセット/カスタム共通のアイコンパス
const presetIconSrc = (p) => p.custom ? "assets/ui/icons/custom.jpg" : `assets/ui/icons/preset-${p.id}.jpg`;

// ビルダーの編集状態
const bld: { editingId: string | null; seq: string[]; workSec: number; restSec: number; rounds: number } =
  { editingId: null, seq: [], workSec: 20, restSec: 10, rounds: 1 };

function renderBuilder() {
  stopCatalog();
  renderBuilderList();
  renderBldGrid();
  updateBldUI();
  show("screen-builder");
}

function renderBuilderList() {
  const list = customMenus();
  const wrap = $("#builder-list");
  if (!list.length) { wrap.innerHTML = ""; return; }
  const esc = (t) => t.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  wrap.innerHTML = list.map((c) =>
    `<div class="bld-row glass" data-id="${c.id}">` +
      `<img src="assets/ui/icons/custom.jpg" alt="">` +
      `<span class="bld-row-info"><b>${esc(c.title)}</b>` +
        `<small>${c.exercises.length}種目 ・ ワーク${c.workSec}秒／休憩${c.restSec}秒 ・ ${c.rounds}周</small></span>` +
      `<button class="bld-edit rank-rename-btn" data-id="${c.id}">編集</button>` +
      `<button class="bld-del rank-rename-btn" data-id="${c.id}">削除</button>` +
    `</div>`).join("");
  wrap.querySelectorAll(".bld-edit").forEach((b) => b.onclick = () => editCustom(b.dataset.id));
  wrap.querySelectorAll(".bld-del").forEach((b) => b.onclick = () => deleteCustom(b.dataset.id));
}

function renderBldGrid() {
  const wrap = $("#bld-grid");
  if (wrap.childElementCount) return; // 一度だけ生成
  Object.keys(EXERCISES).forEach((key) => {
    const item = document.createElement("button");
    item.className = "bld-ex";
    item.innerHTML =
      `<img src="${trainer().thumbDir}/${key}.jpg" alt="">` +
      `<span>${EXERCISES[key].name}</span>`;
    item.onclick = () => {
      if (bld.seq.length >= CUSTOM_LIMITS.maxEx) { showToast(`種目は${CUSTOM_LIMITS.maxEx}個までだよ`); return; }
      bld.seq.push(key);
      updateBldUI();
    };
    wrap.appendChild(item);
  });
}

function updateBldUI() {
  $("#bld-work").textContent = bld.workSec;
  $("#bld-rest").textContent = bld.restSec;
  $("#bld-rounds").textContent = bld.rounds;
  $("#bld-form-title").firstChild.textContent = bld.editingId ? "メニューを編集中" : "新しく作る";
  $("#btn-bld-cancel").hidden = !bld.editingId;
  const wrap = $("#bld-seq");
  if (!bld.seq.length) {
    wrap.innerHTML = `<p class="rank-note">まだ種目がありません。上のグリッドから選んでね</p>`;
  } else {
    wrap.innerHTML = bld.seq.map((key, i) =>
      `<button class="bld-chip" data-i="${i}">` +
        `<img src="${trainer().thumbDir}/${key}.jpg" alt=""><span>${i + 1}</span>` +
      `</button>`).join("");
    wrap.querySelectorAll(".bld-chip").forEach((b) =>
      b.onclick = () => { bld.seq.splice(Number(b.dataset.i), 1); updateBldUI(); });
  }
  const n = bld.seq.length * bld.rounds;
  const workTotal = n * bld.workSec;
  const totalSec = n ? workTotal + (n - 1) * bld.restSec + state.settings.prepareSec : 0;
  $("#bld-summary").textContent = n
    ? `${n}本 ・ 約${Math.max(1, Math.ceil(totalSec / 60))}分 ・ 約${estimateKcal(workTotal)}kcal ・ +${expForResult(workTotal)}修行値`
    : "";
}

function stepBld(t: string, d: number) {
  if (t === "work") bld.workSec = Math.min(CUSTOM_LIMITS.work[1], Math.max(CUSTOM_LIMITS.work[0], bld.workSec + d));
  if (t === "rest") bld.restSec = Math.min(CUSTOM_LIMITS.rest[1], Math.max(CUSTOM_LIMITS.rest[0], bld.restSec + d));
  if (t === "rounds") bld.rounds = Math.min(CUSTOM_LIMITS.rounds[1], Math.max(CUSTOM_LIMITS.rounds[0], bld.rounds + d));
  updateBldUI();
}

function editCustom(id: string) {
  const c = customMenus().find((m) => m.id === id);
  if (!c) return;
  bld.editingId = id;
  bld.seq = [...c.exercises];
  bld.workSec = c.workSec; bld.restSec = c.restSec; bld.rounds = c.rounds;
  $("#bld-name").value = c.title;
  updateBldUI();
  $("#bld-name").scrollIntoView({ behavior: "smooth", block: "center" });
}

function deleteCustom(id: string) {
  const c = customMenus().find((m) => m.id === id);
  if (!c) return;
  if (!confirm(`「${c.title}」を削除する？（完走の記録は消えません）`)) return;
  saveCustomMenus(customMenus().filter((m) => m.id !== id));
  if (bld.editingId === id) resetBld();
  renderBuilderList();
  showToast("削除したよ");
}

function resetBld() {
  bld.editingId = null;
  bld.seq = [];
  bld.workSec = 20; bld.restSec = 10; bld.rounds = 1;
  $("#bld-name").value = "";
  updateBldUI();
}

function saveCustom() {
  if (!bld.seq.length) { showToast("種目を1つ以上選んでね"); return; }
  const title = ($("#bld-name").value || "").trim() || "マイメニュー";
  const list = customMenus();
  const menu = {
    id: bld.editingId || `custom_${Date.now()}`,
    title, short: title,
    tint: "gold", badge: "マイメニュー", desc: "自分で組んだ修行",
    icon: "", pict: "",
    workSec: bld.workSec, restSec: bld.restSec, rounds: bld.rounds, setRestSec: 0,
    exercises: [...bld.seq],
    custom: true,
  };
  const i = list.findIndex((m) => m.id === menu.id);
  if (i >= 0) list[i] = menu; else list.push(menu);
  saveCustomMenus(list);
  showToast(`「${title}」を保存したよ！`);
  resetBld();
  renderBuilderList();
}

// ---- メニュー詳細（開始前に全体像を見せて確認） ----
function openDetail(workout, from) {
  stopCatalog();
  const p = workout;
  state.detailFrom = from || "home";
  const plankSec = state.settings.plankSec || 0;
  const seq = p.exercises.length * p.rounds + (plankSec > 0 ? 1 : 0);
  const workTotal = p.exercises.length * p.rounds * p.workSec + plankSec;
  const totalSec = workTotal + (seq - 1) * p.restSec + state.settings.prepareSec;
  const min = Math.max(1, Math.round(totalSec / 60));
  const kcal = estimateKcal(workTotal);
  $("#detail-title").textContent = p.short || p.title;
  $("#detail-hero").className = `detail-hero glass tint-${p.tint}`;
  $("#detail-hero").innerHTML =
    `<span class="detail-hero-ico"><img src="${presetIconSrc(p)}" alt=""></span>` +
    `<span class="detail-hero-info">` +
      `<span class="detail-badge">${p.badge}</span>` +
      `<b class="detail-hero-title">${p.title}</b>` +
      `<span class="detail-hero-desc">${p.desc}</span>` +
      `<span class="detail-hero-meta">` +
        `<span>🥷 ${seq}種目</span><span>⏱ 約${min}分</span>` +
        `<span>🔁 ${p.rounds}周</span><span>🔥 ${kcal}kcal</span>` +
      `</span>` +
    `</span>`;
  const wrap = $("#detail-ex");
  wrap.innerHTML = "";
  p.exercises.forEach((key, idx) => {
    const row = document.createElement("div");
    row.className = "detail-ex-row glass";
    row.style.animationDelay = `${idx * 0.04}s`;
    row.innerHTML =
      `<span class="detail-ex-no">${idx + 1}</span>` +
      `<div class="detail-ex-thumb"></div>` +
      `<span class="detail-ex-name">${EXERCISES[key].name}</span>` +
      `<span class="detail-ex-sec">${p.workSec}秒</span>`;
    wrap.appendChild(row);
    startThumb(row.querySelector(".detail-ex-thumb"), key);
  });
  if (plankSec > 0) {
    const row = document.createElement("div");
    row.className = "detail-ex-row glass detail-ex-finisher";
    row.style.animationDelay = `${p.exercises.length * 0.04}s`;
    row.innerHTML =
      `<span class="detail-ex-no">仕</span>` +
      `<div class="detail-ex-thumb"></div>` +
      `<span class="detail-ex-name">仕上げプランク</span>` +
      `<span class="detail-ex-sec">${plankSec}秒</span>`;
    wrap.appendChild(row);
    startThumb(row.querySelector(".detail-ex-thumb"), "plank");
  }
  $("#btn-detail-start").onclick = () => { stopCatalog(); startWorkout(p); };
  $("#detail-hero").onclick = null;
  $(".detail-scroll").scrollTop = 0;
  show("screen-detail");
}

function detailBack() {
  stopCatalog();
  if (state.detailFrom === "catalog") renderCatalog();
  else renderHome();
}

// ---- マイページ（設定） ----
function renderMypage() {
  const inv = shieldInv();
  $("#shield-count").textContent = `×${inv.count}`;
  $("#btn-buy-shield").textContent = inv.count >= SHIELD_MAX ? "所持上限" : `${KOBAN_RATES.shieldCost}小判で購入`;
  $("#btn-buy-shield").disabled = inv.count >= SHIELD_MAX;
  const ps = state.settings.plankSec || 0;
  document.querySelectorAll<any>("#seg-plank button").forEach((b) =>
    b.classList.toggle("on", Number(b.dataset.v) === ps));
  const cheer = state.settings.cheer || "normal";
  document.querySelectorAll<any>("#seg-cheer button").forEach((b) =>
    b.classList.toggle("on", b.dataset.v === cheer));
  const st = $("#set-sound");
  st.classList.toggle("on", !!state.settings.sound);
  st.textContent = state.settings.sound ? "ON" : "OFF";
  $("#set-reminder").value = state.settings.reminderTime || "";
  if (!Native.isNative) {
    $("#reminder-note").textContent = "通知はアプリ版（準備中）で届きます。時刻は保存されます";
  }
  show("screen-mypage");
}

function renderCatalog() {
  stopCatalog();
  const list = $("#catalog-list");
  list.innerHTML = "";
  PRESETS.forEach((p, i) => {
    const seq = p.exercises.length * p.rounds;
    const totalSec = seq * p.workSec + (seq - 1) * p.restSec + state.settings.prepareSec;
    const card = document.createElement("div");
    card.className = "catalog-card";
    card.style.animationDelay = `${i * 0.05}s`;
    card.innerHTML =
      `<div class="catalog-card-header">` +
      `<span class="preset-icon tint-${p.tint}"><img src="${presetIconSrc(p)}" alt=""></span>` +
      `<div><div class="catalog-title">${p.title}</div>` +
      `<div class="catalog-meta">${seq}本 ・ 約${Math.ceil(totalSec / 60)}分 ・ ` +
      `ワーク${p.workSec}秒／休憩${p.restSec}秒 ・ ${p.exercises.length}種目×${p.rounds}周</div></div>` +
      `</div>` +
      `<div class="catalog-exercises"></div>`;
    const exWrap = card.querySelector(".catalog-exercises");
    p.exercises.forEach((key, idx) => {
      const item = document.createElement("div");
      item.className = "catalog-ex";
      item.innerHTML =
        `<div class="catalog-thumb"></div>` +
        `<div class="catalog-ex-name">${idx + 1}. ${EXERCISES[key].name}</div>`;
      exWrap.appendChild(item);
      startThumb(item.querySelector(".catalog-thumb"), key);
    });
    const startBtn = document.createElement("button");
    startBtn.className = "catalog-start";
    startBtn.textContent = "この修行を始める";
    startBtn.onclick = () => openDetail(p, "catalog");
    card.appendChild(startBtn);
    list.appendChild(card);
  });
  show("screen-catalog");
}

// ---- 週間ランキング（R3） ----
// クラウドの weekly_ranking RPC を表示。忍び名を設定した人だけ番付に載る
let myNinjaName = "";

async function renderRanking() {
  stopCatalog();
  show("screen-ranking");
  $("#rank-list").innerHTML = `<p class="rank-note">読み込み中…</p>`;
  $("#rank-join").hidden = true;
  $("#rank-mine").hidden = true;

  if (!navigator.onLine) {
    $("#rank-list").innerHTML = `<p class="rank-note">オフラインです。<br>電波のあるところでまた見てみてね。</p>`;
    return;
  }

  // 忍び名・番付・なかまを並行取得
  loadFriendsSection();
  const [name, rows] = await Promise.all([getNinjaName(), fetchWeeklyRanking()]);
  if (!$("#screen-ranking").classList.contains("active")) return; // 読み込み中に画面を離れた
  myNinjaName = name;

  if (name) {
    $("#rank-mine").hidden = false;
    $("#rank-my-name").textContent = name;
  } else {
    $("#rank-join").hidden = false;
  }

  if (rows === null) {
    $("#rank-list").innerHTML = `<p class="rank-note">番付を取得できませんでした。<br>少し時間をおいて開き直してみてね。</p>`;
    return;
  }
  renderRankRows(rows);
}

function renderRankRows(rows) {
  const me = rows.find((r) => r.is_me);
  if (myNinjaName) {
    $("#rank-my-status").textContent = me
      ? `今週 ${me.rank}位 ・ ${me.weekly_exp} 修行値`
      : "今週はまだ圏外。1回完走すれば番付に載るよ！";
  }
  if (!rows.length) {
    $("#rank-list").innerHTML =
      `<p class="rank-note">今週はまだ誰も番付に載っていません。<br>最初の忍びになろう！</p>`;
    return;
  }
  const esc = (t) => t.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  $("#rank-list").innerHTML = rows.map((r) =>
    `<div class="rank-row${r.is_me ? " me" : ""}">` +
      `<span class="rank-no">${r.rank}</span>` +
      `<span class="rank-name">${esc(r.ninja_name)}</span>` +
      `<span class="rank-exp">${r.weekly_exp}<small>修行値</small></span>` +
    `</div>`).join("");
}

async function joinRanking(name) {
  const v = validateNinjaName(name);
  if (v === "empty") { showToast("忍び名を入れてね"); return; }
  if (v === "too_long") { showToast("忍び名は12文字までだよ"); return; }
  if (v === "ng_word") { showToast("その名前は番付には載せられないよ 🥷"); return; }
  showToast("登録中…");
  const ok = await setNinjaName(name);
  if (!ok) { showToast("登録に失敗…電波を確認してもう一度試してね"); return; }
  showToast(`「${name.trim()}」で番付に参加したよ！`);
  renderRanking();
}

// ---- なかま（友達）＆手裏剣 ----
let pokeTargetId: string | null = null;

async function loadFriendsSection() {
  $("#friend-list").innerHTML = `<p class="rank-note">なかまを読み込み中…</p>`;
  const [code, board] = await Promise.all([myFriendCode(), friendsBoard()]);
  if (!$("#screen-ranking").classList.contains("active")) return;
  $("#my-friend-code").textContent = code || "取得できず";
  renderFriendRows(board);
}

function renderFriendRows(board) {
  const esc = (t) => t.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  if (board === null) {
    $("#friend-list").innerHTML = `<p class="rank-note">なかま情報を取得できませんでした</p>`;
    return;
  }
  if (!board.length) {
    $("#friend-list").innerHTML =
      `<p class="rank-note">まだなかまがいません。<br>忍びコードを交換して、一緒に忍ぼう！</p>`;
    return;
  }
  $("#friend-list").innerHTML = board.map((f) =>
    `<div class="friend-row">` +
      `<span class="friend-name">${esc(f.ninja_name)}</span>` +
      (f.done_today ? `<span class="friend-done">今日 完了！</span>` : "") +
      `<span class="friend-exp">${f.weekly_exp}<small>今週</small></span>` +
      `<button class="poke-btn" data-id="${f.friend_id}">手裏剣を投げる</button>` +
    `</div>`).join("");
  $("#friend-list").querySelectorAll(".poke-btn").forEach((b) => {
    b.onclick = () => openPokeMenu(b.dataset.id);
  });
}

function openPokeMenu(friendId: string) {
  pokeTargetId = friendId;
  const wrap = $("#poke-menu-btns");
  wrap.innerHTML = "";
  POKE_MESSAGES.forEach((msg, i) => {
    const b = document.createElement("button");
    b.textContent = `「${msg}」`;
    b.onclick = () => throwPoke(i);
    wrap.appendChild(b);
  });
  $("#poke-menu").hidden = false;
}

async function throwPoke(msgIdx: number) {
  const target = pokeTargetId;
  $("#poke-menu").hidden = true;
  if (!target) return;
  showToast("手裏剣を投げています…");
  const r = await sendPoke(target, msgIdx);
  if (r === "ok") showToast("手裏剣を投げた！相手が次にアプリを開いた時に届くよ 🥷");
  else if (r === "already_today") showToast("その相手には今日はもう投げたよ。また明日！");
  else showToast("投げられなかった…電波を確認してもう一度");
}

// ウィジェットへ現在の状態を届ける（起動時・完走時）
function pushWidgetState() {
  Native.updateWidget({
    streak: streakDays(),
    doneToday: todayStats().count > 0,
    mission: missionStatus().mission.label,
    koban: kobanBalance(),
    date: todayStr(),
  });
}

// 未読の手裏剣が届いていたら、サクヤが知らせる（起動時に呼ぶ）
async function checkPokes() {
  const pokes = await fetchUnseenPokes();
  if (!pokes.length) return;
  const first = pokes[0];
  const msg = POKE_MESSAGES[first.msg_idx] || POKE_MESSAGES[0];
  const extra = pokes.length > 1 ? `（ほか${pokes.length - 1}件）` : "";
  showToast(`🥷 ${first.from_name}から手裏剣：「${msg}」${extra}`, 5000);
  try {
    Sound.init();
    if (Sound.ctx && Sound.ctx.state === "running" && state.settings.sound) {
      Voice.useCtx(Sound.ctx);
      Voice.setBase(trainer().voiceDir);
      Voice.enabled = true;
      Voice.play("poke_received");
    }
  } catch { /* 音が出せなければ表示のみ */ }
  markPokesSeen(pokes.map((p) => p.poke_id));
}

// ---- 記録・ストリーク ----
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// お守りの持ち物: count=未使用数 / covered=お守りが守った日付（streak計算に算入）
function shieldInv(): { count: number; covered: string[] } {
  return store.get("shields", { count: 0, covered: [] });
}

function streakDays() {
  const days = new Set(state.history.filter(h => h.completed).map(h => h.date));
  shieldInv().covered.forEach((d) => days.add(d)); // お守りが守った日も連続に数える
  let streak = 0;
  const d = new Date();
  if (!days.has(todayStr(d))) d.setDate(d.getDate() - 1); // 今日未実施なら昨日起点
  while (days.has(todayStr(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

// 起動時: 連続記録に穴が開いていて、お守りで埋められるなら自動で守る
// （Duolingoのストリークフリーズ相当。途切れ不安を減らすと長期継続がむしろ上がる）
function repairStreakWithShields(): number {
  const inv = shieldInv();
  if (!inv.count) return 0;
  const done = new Set(state.history.filter(h => h.completed).map(h => h.date));
  inv.covered.forEach((d) => done.add(d));
  if (!done.size) return 0;
  const d = new Date();
  d.setDate(d.getDate() - 1); // 今日はまだこれからやれるので、昨日から遡る
  const gap: string[] = [];
  for (let i = 0; i < 30 && !done.has(todayStr(d)); i++) {
    gap.push(todayStr(d));
    d.setDate(d.getDate() - 1);
    if (gap.length > inv.count) return 0; // お守りが足りない穴は守れない（消費もしない）
  }
  if (!gap.length || !done.has(todayStr(d))) return 0; // 穴なし or 守る対象の連続がない
  inv.count -= gap.length;
  inv.covered.push(...gap);
  store.set("shields", inv);
  return gap.length;
}

function buyShield() {
  const inv = shieldInv();
  if (inv.count >= SHIELD_MAX) { showToast(`お守りは${SHIELD_MAX}個まで持てるよ`); return; }
  if (kobanBalance() < KOBAN_RATES.shieldCost) {
    showToast(`小判が足りないよ（お守りは${KOBAN_RATES.shieldCost}小判）`); return;
  }
  addKoban(-KOBAN_RATES.shieldCost, "unlock", "shield");
  inv.count += 1;
  store.set("shields", inv);
  syncNow(state.history);
  renderMypage();
  showToast("お守りを手に入れた！連続記録が1日空いても守ってくれるよ");
}

// ---- 今日の任務 ----
function missionStatus() {
  const m = missionForDate(todayStr());
  const todays = state.history.filter((h) => h.date === todayStr() && h.completed);
  let done = false;
  if (m.id === "any") done = todays.length >= 1;
  else if (m.id === "any2") done = todays.length >= 2;
  else done = todays.some((h) => h.workoutId === m.id);
  return { mission: m, done, count: todays.length };
}

function saveResult(workout, totalWorkSec) {
  const beforeDone = missionStatus().done;
  const weekBefore = weekRecord().count;
  const entry: HistoryEntry = {
    date: todayStr(), workoutId: workout.id, title: workout.title,
    totalWorkSec, completed: true, ts: Date.now(),
  };
  state.history.push(entry);
  // ボーナス修行値：今日の任務の初達成＋連続日数ボーナス（2日目+5〜7日目以降+30）
  state.lastMissionCleared = !beforeDone && missionStatus().done;
  state.lastStreakBonus = streakBonusExp(streakDays());
  const bonus = (state.lastMissionCleared ? MISSION_BONUS_EXP : 0) + state.lastStreakBonus;
  if (bonus > 0) entry.bonusExp = bonus;
  state.lastBonusExp = bonus;
  store.set("history", state.history);

  // 小判の付与（append-only台帳）。完走＋任務＋週目標をこの完走が跨いだ分だけ
  let earned = addKoban(KOBAN_RATES.workout, "workout", String(entry.ts)).delta;
  if (state.lastMissionCleared) earned += addKoban(KOBAN_RATES.mission, "mission", String(entry.ts)).delta;
  if (weekBefore < WEEKLY_GOAL && weekRecord().count >= WEEKLY_GOAL) {
    earned += addKoban(KOBAN_RATES.weekGoal, "week_goal", String(entry.ts)).delta;
  }
  if (weekBefore < 7 && weekRecord().count >= 7) {  // パーフェクト週（7日全部）
    earned += addKoban(KOBAN_RATES.perfectWeek, "week_goal", `perfect_${entry.date}`).delta;
  }
  state.lastKobanEarned = earned;

  Native.backup();                                              // ネイティブ: 記録をPreferencesへ複製
  pushWidgetState();
  Native.syncReminder(state.settings.reminderTime, true, streakDays()); // 完走した日の通知はスキップ→明日に予約し直し
  syncNow(state.history);                                       // クラウド同期（未サインイン・オフラインなら静かにスキップ）
}

// ---- Wake Lock ----
async function acquireWakeLock() {
  Native.keepAwake(true);
  try {
    if ("wakeLock" in navigator) state.wakeLock = await navigator.wakeLock.request("screen");
  } catch { /* 非対応・省電力モードでは黙って諦める */ }
}
function releaseWakeLock() {
  Native.keepAwake(false);
  state.wakeLock?.release().catch(() => {});
  state.wakeLock = null;
}

// ---- 進捗（忍びランク・今日/今週の集計・文脈セリフ）----
function totalExp() {
  return state.history
    .filter(h => h.completed)
    .reduce((sum, h) => sum + expForResult(h.totalWorkSec) + (h.bonusExp || 0), 0);
}

function todayStats() {
  const t = todayStr();
  const today = state.history.filter(h => h.completed && h.date === t);
  const workSec = today.reduce((a, h) => a + h.totalWorkSec, 0);
  return { count: today.length, workSec, kcal: estimateKcal(workSec) };
}

// 今週（月曜始まり）の活動日ドット。やさしく「日数」で数える
function weekRecord() {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // 月=0 … 日=6
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow);
  const doneDates = new Set(state.history.filter(h => h.completed).map(h => h.date));
  const todayS = todayStr(now);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const ds = todayStr(d);
    days.push({ label: "月火水木金土日"[i], done: doneDates.has(ds), isToday: ds === todayS });
  }
  return { days, count: days.filter(d => d.done).length, goal: WEEKLY_GOAL };
}

// ホームの一言：初回・久しぶり（責めない）・連続・時間帯で出し分け
// 戻り値はボイスキー（VOICE_LINESに表示文言、assets/audio/<trainer>/に音声がある）
function homeGreetingKey(): string {
  const completed = state.history.filter(h => h.completed);
  if (completed.length === 0) return "greet_first";
  const last = completed[completed.length - 1];
  const daysSince = Math.round(
    (new Date(todayStr() + "T00:00:00").getTime() - new Date(last.date + "T00:00:00").getTime()) / 86400000);
  if (daysSince >= 3) return "greet_comeback";
  if (streakDays() >= 2) return "greet_streak";
  const hour = new Date().getHours();
  if (hour < 10) return "greet_morning";
  if (hour >= 20) return "greet_night";
  return "greet_noon";
}

function presetCompletions(id) {
  return state.history.filter(h => h.completed && h.workoutId === id).length;
}

function renderStatusCard() {
  const exp = totalExp();
  const r = rankInfo(exp);
  const ts = todayStats();
  const wr = weekRecord();
  const pct = Math.round(r.progress * 100);
  const m = Math.floor(ts.workSec / 60), sc = Math.round(ts.workSec % 60);
  const timeStr = `${String(m).padStart(2, "0")}:${String(sc).padStart(2, "0")}`;
  const strip = wr.days.map(d =>
    `<span class="hud-wd${d.done ? " done" : ""}${d.isToday ? " today" : ""}">${d.label}</span>`).join("");
  $("#status-card").innerHTML =
    `<div class="hud-metrics">` +
      `<div class="hud-metric"><span class="hud-m-ico">🔥</span><b>${ts.kcal}</b><small>消費kcal</small></div>` +
      `<div class="hud-metric"><span class="hud-m-ico">⏱️</span><b>${timeStr}</b><small>運動時間</small></div>` +
      `<div class="hud-metric"><span class="hud-m-ico">⭐</span><b>${exp}</b><small>修行値</small></div>` +
      `<div class="hud-metric hud-metric-rank">` +
        `<small class="hud-rank-cap">忍びランク</small><b>${r.name}</b>` +
        `<span class="hud-rank-exp"><i style="width:${pct}%"></i></span>` +
        `<small class="hud-rank-next">${r.next ? `あと ${r.remain}` : "最高位！"}</small>` +
      `</div>` +
    `</div>` +
    `<div class="hud-week"><span class="hud-week-lbl">今週 <b>${wr.count}/${wr.goal}日</b></span>` +
    `<span class="hud-wd-row">${strip}</span>` +
    `<span class="hud-koban"><img src="assets/ui/icons/koban.jpg" alt="">${kobanBalance()}</span></div>`;
  const en = $("#hud-energy");
  if (en) en.innerHTML = `⚡ <b>${wr.count}/${wr.goal}</b>`;
}

// ホームのサクヤをタップ→声つきでセリフが変わる。
// 初回タップは表示中のあいさつをそのまま喋る（iOSは初タップでAudioContextが解錠される）
let homeLineKey = "greet_first";   // いま表示中のセリフのボイスキー
let homeGreetingSpoken = false;    // このホーム表示であいさつを喋ったか
let greetingAutoSpoken = false;    // セッション中に自動あいさつを済ませたか（連発防止）
let homeJoyPose = 2;               // いま表示中のjoyポーズ番号(1〜4)

// 音声が解錠済み（＝一度でも操作済み or ネイティブ）なら、ホーム到着時にあいさつを自動発声
function maybeSpeakGreeting() {
  if (greetingAutoSpoken) return;
  try {
    Sound.init(); // 未解錠ならsuspendedのままになるだけで害はない
    if (Sound.ctx && Sound.ctx.state === "running") {
      greetingAutoSpoken = true;
      homeGreetingSpoken = true;
      speakHomeLine(homeLineKey);
    }
  } catch { /* 音が出せない環境ではテキストのみ */ }
}

// タップ演出：くるっと回転しながら別のjoyポーズへ切り替え
function spinHomeChara() {
  const box = $("#home-chara");
  let n = homeJoyPose;
  while (n === homeJoyPose) n = 1 + Math.floor(Math.random() * 4);
  homeJoyPose = n;
  box.classList.remove("chara-spin");
  void box.offsetWidth; // アニメーション再発火
  box.classList.add("chara-spin");
  // 半回転して背中を向いた瞬間（約50%地点）にポーズを差し替えると「回ったら変わってた」に見える
  setTimeout(() => showPose(box, `joy_${homeJoyPose}`, trainer().name), 260);
}

function speakHomeLine(key: string) {
  Sound.init();
  Voice.useCtx(Sound.ctx);
  Voice.setBase(trainer().voiceDir);
  Voice.enabled = state.settings.sound;
  Voice.preload(HOME_TAP_KEYS);
  Voice.play(key);
}

function nextHomeQuote() {
  spinHomeChara();
  const el = $("#home-quote");
  if (!homeGreetingSpoken) {
    homeGreetingSpoken = true;      // まずは表示中のあいさつを声で
  } else {
    let key = pick(HOME_TAP_KEYS);
    for (let i = 0; i < 5 && key === homeLineKey; i++) key = pick(HOME_TAP_KEYS);
    homeLineKey = key;
    el.textContent = VOICE_LINES[key];
  }
  speakHomeLine(homeLineKey);
  el.classList.remove("bubble-pop");
  void el.offsetWidth; // アニメーション再発火
  el.classList.add("bubble-pop");
}

// ---- ホーム画面 ----
function renderHome() {
  stopCatalog();
  // ヒーローカードでは「迎えてくれる」joyポーズ（いいね）を表示
  showPose($("#home-chara"), "joy_2", trainer().name);
  homeLineKey = homeGreetingKey();
  homeGreetingSpoken = false;
  $("#home-quote").textContent = VOICE_LINES[homeLineKey];
  maybeSpeakGreeting();
  for (let i = 1; i <= 4; i++) new Image().src = `${trainer().dir}/joy_${i}.png`;
  renderStatusCard();
  const list = $("#preset-list");
  list.innerHTML = "";
  [...PRESETS, ...customMenus()].forEach((p, i) => {
    const seq = p.exercises.length * p.rounds;
    const totalSec = seq * p.workSec + (seq - 1) * p.restSec + state.settings.prepareSec;
    const kcal = estimateKcal(seq * p.workSec);
    const done = presetCompletions(p.id);
    const goal = 10;
    const pct = Math.min(100, Math.round(done / goal * 100));
    const li = document.createElement("button");
    li.className = `hud-card tint-${p.tint}`;
    li.style.animationDelay = `${i * 0.05}s`;
    li.innerHTML =
      `<span class="hud-card-icon"><img class="hud-card-icon-rich" src="${presetIconSrc(p)}" alt=""></span>` +
      `<span class="hud-card-body">` +
        `<b class="hud-card-title">${p.short || p.title}</b>` +
        `<span class="hud-card-prog"><span class="hud-prog-bar"><i style="width:${pct}%"></i></span>` +
          `<span class="hud-prog-num">${done}/${goal}</span></span>` +
      `</span>` +
      `<span class="hud-card-go">›</span>`;
    li.onclick = () => openDetail(p, "home");
    list.appendChild(li);
  });
  const tc = todayStats().count;
  const ms = missionStatus();
  $("#hud-ch-desc").textContent = ms.done
    ? `${ms.mission.label} ── クリア！ ✓`
    : `${ms.mission.label}（＋${MISSION_BONUS_EXP}修行値）`;
  $("#hud-challenge").classList.toggle("cleared", ms.done);
  show("screen-home");
}

function renderHistory() {
  const el = $("#history-list");
  const items = [...state.history].reverse().slice(0, 30);
  $("#history-total").textContent =
    `完走 ${state.history.length}回 ・ 累計 ${Math.round(state.history.reduce((a, h) => a + h.totalWorkSec, 0) / 60)}分`;
  el.innerHTML = items.length
    ? items.map(h => `<li>${h.date}　${h.title}</li>`).join("")
    : "<li>まだ記録がないよ。最初の4分から！</li>";
}

// ---- ワークアウト実行 ----
function startWorkout(workout) {
  Sound.init();
  Sound.enabled = state.settings.sound;
  Voice.useCtx(Sound.ctx);
  Voice.setBase(trainer().voiceDir);
  Voice.enabled = state.settings.sound;
  // 応援ボイスの量：many=多め（従来どおり全部） / normal=あと10秒＋3-2-1のみ / few=3-2-1のみ
  const cheer = state.settings.cheer || "normal";
  const cheerMany = cheer === "many";
  const cheerFew = cheer === "few";
  // 声を出す時は必ず同じセリフを画面にも出す（音声と表示のズレをなくす）
  const say = (names) => {
    const name = Voice.playOne(Array.isArray(names) ? names : [names]);
    $("#run-quote").textContent = VOICE_LINES[name] || "";
    return name;
  };
  // この修行で使う声を先読み（定型＋登場種目の「最初は/つぎは」）
  const plankSec = state.settings.plankSec || 0;
  const exKeys = [...new Set([...workout.exercises, ...(plankSec > 0 ? ["plank"] : [])])];
  Voice.preload([
    "count_3", "count_2", "count_1",
    ...(cheerFew ? [] : ["last10_1", "last10_2", "finish_1", "finish_2",
      ...exKeys.map((k) => `first_${k}`), ...exKeys.map((k) => `next_${k}`)]),
    ...(cheerMany ? ["go_1", "go_2", "mid_1", "mid_2", "mid_3"] : []),
  ]);
  acquireWakeLock();
  state.currentWorkout = workout;

  let lastTickSec = null;

  const engine = new WorkoutEngine(workout, state.settings.prepareSec, {
    onSegmentChange(seg, next) {
      // 「休憩」の単調な表示をやめ、次に何が来るかが分かるリッチな表示にする
      const restLabel = next ? `つぎは、${EXERCISES[next.exercise].name}` : "お疲れさま！";
      const label = { prepare: "準備して！", work: EXERCISES[seg.exercise].name, rest: restLabel }[seg.type];
      $("#run-phase").innerHTML =
        `<img class="run-phase-ico" src="assets/ui/icons/phase-${seg.type}.jpg" alt="">${label}`;
      $("#run-progress").textContent = `エクササイズ ${seg.slot}/${seg.total}`;
      $("#screen-run").className = `screen hud active phase-${seg.type}`;
      $("#run-next").textContent = next
        ? `次のエクササイズ：${EXERCISES[next.exercise].name}`
        : "次：トレーニング終了";

      // 準備・休憩中は次にやる種目のお手本を先に見せる（タバタ方式）
      playSprite($("#run-chara"), seg.exercise);

      $("#run-quote").textContent = "";
      if (seg.type === "work") {
        Sound.workStart();
        if (cheerMany) say(["go_1", "go_2"]);                   // 「いくよっ！」（種目名は直前に予告済み）
      } else if (seg.type === "rest") {
        Sound.restStart();
        if (next && !cheerFew) {
          Voice.play(`next_${next.exercise}`);                  // 休憩中に次の種目を予告
          $("#run-quote").textContent = voiceLineNext(next.exercise);
        }
      } else {
        if (!cheerFew) {
          Voice.play(`first_${seg.exercise}`);                  // 開始「最初は、〇〇！」
          $("#run-quote").textContent = voiceLineFirst(seg.exercise);
        }
      }
      lastTickSec = null;
    },

    onTick(seg, remain, ratio) {
      const sec = Math.ceil(remain);
      $("#run-count").textContent = sec;
      $("#run-count").classList.toggle("urgent", sec <= 3 && sec >= 1);
      $("#hbar-fill").style.width = `${Math.max(0, (1 - ratio) * 100)}%`; // 残り時間ぶんが縮む

      if (sec !== lastTickSec) {
        lastTickSec = sec;
        // ワーク・休憩・準備の終わる瞬間、カウントに合わせて「さん・に・いち」（全モード共通）
        if (sec <= 3 && sec >= 1) {
          Sound.countTick();
          Voice.play(`count_${sec}`);
          Native.tick();                                        // ネイティブ: 軽い振動
        }
        if (seg.type === "work" && sec === 10 && seg.sec > 12 && !cheerFew) {
          say(["last10_1", "last10_2"]);                        // ラスト10秒（多め・普通で言う）
        }
        // 中盤の応援は「多め」のときだけ。20秒ワークでは中間=10秒＝ラスト10秒と衝突するため14秒地点で言う
        const midSec = seg.sec >= 25 ? Math.ceil(seg.sec / 2) : 14;
        if (seg.type === "work" && sec === midSec && sec !== 10 && seg.sec > 15 && cheerMany) {
          say(["mid_1", "mid_2", "mid_3"]);
        }
      }
    },

    async onFinish() {
      Sound.finish();
      // 完走セリフも音声と表示を一致させる（少なめモードは3-2-1のみなので声なし）
      state.lastFinishLine = cheerFew ? null : VOICE_LINES[Voice.playOne(["finish_1", "finish_2"])];
      Native.finishBuzz();
      $("#run-chara video")?.pause();
      releaseWakeLock();
      saveResult(workout, engine.totalWorkSec);
      await maybeShowInterstitial();   // 広告の幕間スロット（現状は常に素通り。設計書§7）
      renderDone(workout, engine.totalWorkSec);
    },
  }, plankSec);

  state.engine = engine;
  $("#run-title").textContent = workout.title;
  $("#btn-pause").textContent = "⏸";
  show("screen-run");
  engine.start();
}

function togglePause() {
  const e = state.engine;
  if (!e || e.finished) return;
  if (e.pausedAt === null) {
    e.pause();
    Voice.stop();
    $("#run-chara video")?.pause();
    $("#btn-pause").textContent = "▶";
  } else {
    e.resume();
    playSprite($("#run-chara"), e.current.exercise);
    $("#btn-pause").textContent = "⏸";
  }
}

function quitWorkout() {
  if (!confirm("修行を中断する？")) return;
  state.engine?.stop();
  Voice.stop();
  $("#run-chara video")?.pause();
  releaseWakeLock();
  renderHome();
}

// ---- 完了画面 ----
const JOY_POSE_COUNT = 4; // joy_1〜joy_4 を完走のたびに順番に使う
const CONFETTI_COLORS = ["#ff4f81", "#ffb648", "#2b3a67", "#57966a", "#ff8a4f", "#fff"];

function fireConfetti() {
  const layer = $("#confetti-layer");
  layer.innerHTML = "";
  const pieces = 36;
  for (let i = 0; i < pieces; i++) {
    const el = document.createElement("div");
    el.className = "confetti-piece";
    el.style.left = `${Math.random() * 100}%`;
    el.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    el.style.animationDuration = `${2 + Math.random() * 1.4}s`;
    el.style.animationDelay = `${Math.random() * 0.5}s`;
    el.style.transform = `rotate(${Math.random() * 360}deg)`;
    layer.appendChild(el);
  }
  setTimeout(() => { layer.innerHTML = ""; }, 4000);
}

function renderDone(workout, totalWorkSec) {
  const joyIndex = (state.history.length % JOY_POSE_COUNT) + 1;
  showPose($("#done-chara"), `joy_${joyIndex}`, trainer().name);
  fireConfetti();
  const s = streakDays();

  // 修行値と昇格判定（saveResultで履歴に追加済みなので、今回分を引いて前後比較）
  const missionCleared = !!state.lastMissionCleared;
  const gained = expForResult(totalWorkSec) + (state.lastBonusExp || 0);
  const expAfter = totalExp();
  const rankBefore = rankInfo(expAfter - gained);
  const rankAfter = rankInfo(expAfter);
  const leveledUp = rankAfter.index > rankBefore.index;

  // 昇格＞連続記録＞完走セリフ（完走セリフは直前に鳴った声と同じ文言を出す）
  $("#done-quote").textContent = leveledUp
    ? `やった、${rankAfter.name}に昇格だね！おめでとう🎉`
    : (s >= 2 ? quote("streak", { days: s }) : (state.lastFinishLine || quote("finish")));
  $("#done-stats").innerHTML =
    `<li>${workout.title} 完走 🎉</li>` +
    `<li>運動時間 ${Math.round(totalWorkSec / 60 * 10) / 10}分 ・ 約${estimateKcal(totalWorkSec)}kcal</li>` +
    `<li>🥷 ${rankAfter.name} ・ +${gained} 修行値</li>` +
    `<li><img class="koban-ico" src="assets/ui/icons/koban.jpg" alt="">+${state.lastKobanEarned || 0} 小判（計 ${kobanBalance()}）</li>` +
    (missionCleared ? `<li>🚩 今日の任務クリア！（＋${MISSION_BONUS_EXP}修行値込み）</li>` : "") +
    (state.lastStreakBonus ? `<li>🔥 連続${streakDays()}日ボーナス ＋${state.lastStreakBonus}修行値込み</li>` : "") +
    `<li>${s > 0 ? `🔥 ${s}日連続` : "また明日も待ってるよ"}</li>`;
  const text = encodeURIComponent(
    `${trainer().name}と一緒に「${workout.title}」完走した！🥷 #サクヤ4分HIIT #CryptoNinja`);
  $("#btn-share").href = `https://twitter.com/intent/tweet?text=${text}`;
  show("screen-done");
}

// ---- トースト（準備中の案内など） ----
let toastTimer = null;
function showToast(msg, ms = 2200) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

// ---- 初期化 ----
document.addEventListener("DOMContentLoaded", () => {
  $("#btn-pause").onclick = togglePause;
  $("#btn-quit").onclick = quitWorkout;
  $("#btn-done-home").onclick = renderHome;
  $("#btn-catalog").onclick = renderCatalog;
  $("#btn-catalog-back").onclick = renderHome;
  $("#btn-detail-back").onclick = detailBack;
  $("#tab-mypage").onclick = renderMypage;
  $("#btn-mypage-back").onclick = renderHome;
  document.querySelectorAll<any>("#seg-plank button").forEach((b) => {
    b.onclick = () => {
      state.settings.plankSec = Number(b.dataset.v);
      store.set("settings", state.settings);
      renderMypage();
      showToast(state.settings.plankSec > 0
        ? `仕上げプランク ${state.settings.plankSec}秒 をセット！ 🥷`
        : "仕上げプランクをオフにしたよ");
    };
  });
  document.querySelectorAll<any>("#seg-cheer button").forEach((b) => {
    b.onclick = () => {
      state.settings.cheer = b.dataset.v;
      store.set("settings", state.settings);
      renderMypage();
      showToast({ few: "応援少なめ：3・2・1だけ言うね",
                  normal: "応援普通：あと10秒とカウントだけ言うね",
                  many: "応援多め：たくさん話しかけるね！" }[b.dataset.v]);
    };
  });
  $("#set-sound").onclick = () => {
    state.settings.sound = !state.settings.sound;
    Sound.enabled = state.settings.sound;
    Voice.enabled = state.settings.sound;
    if (!state.settings.sound) Voice.stop();
    store.set("settings", state.settings);
    renderMypage();
  };
  $("#btn-buy-shield").onclick = buyShield;
  $("#set-reminder").onchange = async (e) => {
    state.settings.reminderTime = e.target.value || "";
    store.set("settings", state.settings);
    const r = await Native.syncReminder(state.settings.reminderTime, todayStats().count > 0, streakDays());
    if (r === "denied") showToast("通知が許可されていません。端末の設定から許可してね");
    else if (state.settings.reminderTime) showToast(`毎日 ${state.settings.reminderTime} にサクヤが誘いに来るよ 🔔`);
    else showToast("リマインダーをオフにしたよ");
  };
  document.querySelectorAll<any>(".hud-tab[data-soon]").forEach(b => {
    b.onclick = () => showToast(`${b.dataset.soon} はただいま準備中だよ 🥷`);
  });
  $("#hud-ranking").onclick = renderRanking;
  $("#btn-builder").onclick = renderBuilder;
  $("#btn-builder-back").onclick = renderHome;
  $("#btn-bld-save").onclick = saveCustom;
  $("#btn-bld-cancel").onclick = resetBld;
  document.querySelectorAll<any>(".stepper button").forEach((b) =>
    b.onclick = () => stepBld(b.dataset.t, Number(b.dataset.d)));
  $("#home-chara").onclick = nextHomeQuote;
  $("#btn-ranking-back").onclick = renderHome;
  $("#btn-rank-join").onclick = () => joinRanking($("#rank-name-input").value);
  $("#rank-name-input").onkeydown = (e) => { if (e.key === "Enter") joinRanking($("#rank-name-input").value); };
  $("#btn-copy-code").onclick = async () => {
    const code = $("#my-friend-code").textContent;
    try { await navigator.clipboard.writeText(code); showToast(`コード「${code}」をコピーしたよ`); }
    catch { showToast(`コードは「${code}」だよ（手動でメモしてね）`, 3500); }
  };
  $("#btn-add-friend").onclick = async () => {
    const code = ($("#friend-code-input").value || "").trim();
    if (code.length < 6) { showToast("6文字のコードを入れてね"); return; }
    showToast("さがしています…");
    const r = await addFriendByCode(code);
    if (r.ok) {
      $("#friend-code-input").value = "";
      showToast(`「${r.name}」となかまになったよ！🥷`);
      loadFriendsSection();
    } else {
      showToast("そのコードの忍びが見つからないよ");
    }
  };
  $("#poke-menu-cancel").onclick = () => { $("#poke-menu").hidden = true; };
  $("#btn-rank-rename").onclick = () => {
    const name = prompt("新しい忍び名（12文字まで）", myNinjaName);
    if (name !== null) joinRanking(name);
  };
  $("#hud-challenge").onclick = () => {
    const ms = missionStatus();
    if (ms.done) { showToast("今日の任務はクリア済み！おかわりも歓迎だよ 🥷"); return; }
    const preset = PRESETS.find((p) => p.id === ms.mission.id);
    if (preset) openDetail(preset, "home");
    else showToast("メニューを1つ選んで、今日の4分をはじめよう！");
  };
  $("#btn-sound").onclick = () => {
    state.settings.sound = !state.settings.sound;
    Sound.enabled = state.settings.sound;
    Voice.enabled = state.settings.sound;
    if (!state.settings.sound) Voice.stop();
    store.set("settings", state.settings);
    $("#btn-sound").textContent = state.settings.sound ? "🔊" : "🔇";
  };
  $("#btn-sound").textContent = state.settings.sound ? "🔊" : "🔇";

  // ホームのバージョン表示：package.jsonのversionがViteのdefineで注入される
  $("#app-version").textContent = `v${__APP_VERSION__.split(".").slice(0, 2).join(".")}`;
  recordFirstLaunch();

  // 開発時のみ：コンソールからの動作確認用フック（本番ビルドでは消える）
  if (import.meta.env.DEV) {
    (window as any).__dbg = { state, startWorkout, renderCatalog, renderHome, renderDone, saveResult, Voice, nextHomeQuote, Sound, flags: () => ({ homeGreetingSpoken, greetingAutoSpoken, homeLineKey }) };
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.engine && !state.engine.finished) acquireWakeLock();
  });

  // ネイティブ(Capacitor)ではアセット同梱のためSW不要（capacitor://で動くので条件的にも登録されない）
  if ("serviceWorker" in navigator && location.protocol === "https:" && !window.Capacitor) {
    navigator.serviceWorker.register("sw.js");
  }
  renderHome();

  // ネイティブ: localStorageが消えていたらPreferencesのバックアップから復元→リマインダーを予約し直す
  if (Native.isNative) {
    Native.restoreIfEmpty().then((restored) => {
      if (restored) { location.reload(); return; }
      Native.syncReminder(state.settings.reminderTime, todayStats().count > 0, streakDays());
    });
  }

  // 起動直後のもたつきを避けて、少し後にクラウド同期（前回未送信分の回収）→手裏剣チェック
  pushWidgetState();
  setTimeout(() => { syncNow(state.history); checkPokes(); }, 3000);
});
