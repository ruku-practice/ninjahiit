// NinjaHIIT アプリ本体：画面管理・スプライト再生・記録

import {
  EXERCISES, PRESETS, TRAINERS, VOICE_LINES, quoteLines, voiceLineFirst, voiceLineNext,
  TUTORIAL_VIDEOS, TUTORIAL_READY, shouldShowTutorialPrompt, tutorialQueue,
  DEFAULT_SETTINGS, estimateKcal, expForResult, rankInfo, WEEKLY_GOAL, voiceLineLast,
  MISSION_BONUS_EXP, missionForDate, streakBonusExp, HOME_TAP_KEYS, weekDoneArray,
  recommendWorkout, yesterdaySummary, shouldShowHealthNotice, pauseButtonState,
  restBannerLabel, runNextLabel, soundIconState, fitFontSize, shareImageFileName,
} from "./data.ts";
import { Bgm, Sound, Voice } from "./audio.ts";
import { WorkoutEngine } from "./timer.ts";
import { Native } from "./native.ts";
import { KOBAN_RATES, SHIELD_MAX, addKoban, kobanBalance, kobanLedger, canEarnPokeKoban } from "./points.ts";
import { maybeShowInterstitial, recordFirstLaunch } from "./ads.ts";
import { syncNow } from "./sync.ts";
import { ensureSignedIn, isOAuthReturnUrl } from "./cloud.ts";
// Google連携(linkGoogle/signOutGoogle/getIdentityStatus)はv1でUIを蓋にしたため未import。
// 将来復活のため関数自体はcloud.tsに残置（審査前仕分け§1b・2026-07-21ルク決定）。
import {
  fetchWeeklyRanking, getNinjaName, setNinjaName, validateNinjaName,
  hiddenNinjas, hideNinja, unhideNinja, filterHiddenRanking,
} from "./ranking.ts";
import {
  POKE_MESSAGES, addFriendByCode, fetchUnseenPokes, friendsBoard, markPokesSeen, myFriendCode, sendPoke,
  removeFriend, removeFriendFromBoard, pokeableFriends,
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
  // レイヤー分割キャラ表示中なら畳んでから1枚絵に戻す（最初のimgがレイヤーを掴まないように）
  if (el.querySelector(".st-chara")) { el.innerHTML = ""; delete el.dataset.livePose; }
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
  const tryPlay = () => retryPlayVideo(video);
  tryPlay();
  video.addEventListener("canplay", tryPlay, { once: true });
}

// バックグラウンド復帰直後の video.play() はWKWebViewに拒否されることがある。srcは変わらないので
// canplayも再発火せず、タイムゲージだけ進んでお手本動画が止まって見える（2026-07-23 ルク実機報告・UT B-7）。
// 拒否は一時的なので、短い間隔で数回だけ再試行する。
function retryPlayVideo(video, tries = 4) {
  if (!video) return;
  video.play().catch(() => {
    if (tries > 0) setTimeout(() => retryPlayVideo(video, tries - 1), 250);
  });
}

// 復帰時は play() が成功してもフレームが進まないことがある（バックグラウンド中にデコーダが
// 解放され、要素は再生中のつもりなのに絵が止まったまま＝v0.75.1・v0.75.2で再現）。
// 「鳴らせたか」ではなく「実際に再生位置が進んだか」で判定し、段階的に強い手を打つ：
//   ①play()の再試行 → ②load()でデコーダを作り直す → ③<video>要素ごと作り直す
// ③まで要るのは、WebContentプロセス側でデコーダが失われるとload()でも絵が戻らないため
// （2026-07-23 ルク実機：タイムゲージは進むのに絵だけ止まったまま）。
function videoProgressing(video, before) {
  return !!video && !video.paused && video.currentTime !== before;
}

function ensureVideoPlaying(video) {
  if (!video) return;
  const before = video.currentTime;
  retryPlayVideo(video);
  setTimeout(() => {
    if (!video.isConnected || videoProgressing(video, before)) return;
    const t2 = video.currentTime;
    video.load();                 // ②デコーダを作り直す（頭出しになる）
    retryPlayVideo(video);
    setTimeout(() => {
      if (!video.isConnected || videoProgressing(video, t2)) return;
      // ③要素ごと作り直して新しいデコーダを割り当てる
      const e = state.engine;
      const box = $("#run-chara");
      if (!e || e.finished || !box || !box.contains(video)) return;
      box.innerHTML = "";
      playSprite(box, e.current.exercise);
    }, 600);
  }, 500);
}

function showPose(el, pose, label) {
  if (showLiveChara(el, pose, label)) return;
  setCharaImage(el, `${trainer().dir}/${pose}.png`, label, 1);
}

// ---- レイヤー分割キャラ（See-throughで1枚絵を自動分割した live アセット）----
// ホームの固定絵だけ、静止画の代わりに深度順レイヤーを重ねて表示し、
// 呼吸・ポニーテールゆれ・頭のゆらぎ・まばたきのCSSアニメを当てる。
// まばたきは目のレイヤーを一瞬つぶすと裏の肌（AIが補完した隠れ部分）が見える仕組み。
// レイヤーが読み込めなければ従来の1枚絵に自動で戻す。
// 各ポーズ: files=レイヤー(奥→手前)、aspect=切り抜きの縦横比、
// bob=首のつけ根 / sway=ポニーテール結び目 / blink=目の中心（いずれも切り抜き内%座標。PSDのbboxから算出）
// blinkTilt=左右の目を結ぶ線の角度。顔が傾いたポーズでまぶたが横一直線に閉じないようにする
const LIVE_POSES = {
  "assets/characters/sakuya": {
    joy_1: {
      files: ["00_back_hair", "01_handwear", "02_footwear", "03_headwear", "04_legwear",
        "05_topwear", "06_neck", "07_ears", "08_face", "09_nose", "10_mouth",
        "11_eyewhite", "12_irides", "13_eyelash", "14_front_hair"],
      aspect: "379 / 758", arm: "38.79% 33.25%", bob: "47.23% 35.22%", sway: "53.43% 24.01%", blink: "51.72% 25.99%", blinkTilt: "15.8deg",
    },
    joy_2: {
      files: ["00_back_hair", "01_footwear", "02_legwear", "03_neck", "04_headwear",
        "05_handwear", "06_topwear", "07_ears", "08_face", "09_mouth",
        "10_nose", "11_eyewhite", "12_irides", "13_eyelash", "14_front_hair"],
      aspect: "303 / 764", arm: "50.83% 31.81%", bob: "55.45% 33.38%", sway: "69.97% 10.47%", blink: "54.79% 23.69%", blinkTilt: "-4.5deg",
    },
    joy_3: {
      files: ["00_back_hair", "01_headwear", "02_footwear", "03_legwear", "04_topwear",
        "05_ears", "06_face", "07_mouth", "08_nose", "09_eyewhite",
        "10_irides", "11_eyelash", "12_handwear", "13_front_hair"],
      aspect: "307 / 759", arm: "43.65% 33.33%", bob: "44.63% 33.33%", sway: "40.16% 21.52%", blink: "44.14% 25.43%", blinkTilt: "-7.1deg",
    },
    joy_4: {
      files: ["00_back_hair", "01_headwear", "02_footwear", "03_legwear", "04_topwear",
        "05_ears", "06_face", "07_mouth", "08_nose", "09_eyewhite",
        "10_irides", "11_handwear", "12_eyelash", "13_front_hair"],
      aspect: "298 / 760", arm: "38.26% 30.00%", bob: "37.58% 31.18%", sway: "37.58% 22.04%", blink: "35.91% 23.42%", blinkTilt: "-6.2deg",
    },
    joy_5: {
      files: ["00_back_hair", "01_footwear", "02_legwear", "03_neck", "04_handwear",
        "05_topwear", "06_ears", "07_face", "08_mouth", "09_nose",
        "10_eyewhite", "11_irides", "12_eyelash", "13_headwear", "14_front_hair"],
      aspect: "345 / 736", arm: "48.84% 33.02%", bob: "50.43% 35.05%", sway: "49.57% 21.54%", blink: "49.71% 22.55%", blinkTilt: "-4.9deg",
    },
  },
};
// パーツ名→動きのクラス。st-sway=髪ゆれ、st-bob=頭のゆらぎ、st-arm=腕のゆれ、st-blink=まばたき（imgに付与）
const LIVE_PART_MOTION = {
  back_hair: "st-sway",
  handwear: "st-arm",
  headwear: "st-bob", ears: "st-bob", face: "st-bob", mouth: "st-bob", nose: "st-bob",
  front_hair: "st-bob",
  eyewhite: "st-bob st-blink", irides: "st-bob st-blink", eyelash: "st-bob st-blink",
};
let liveCharaBroken = false; // 一度でも読み込みに失敗したら以後は1枚絵で運用

function showLiveChara(el, pose, label) {
  if (liveCharaBroken || el.id !== "home-chara") return false;
  const data = (LIVE_POSES[trainer().dir] || {})[pose];
  if (!data) return false;
  if (el.dataset.livePose === pose && el.querySelector(".st-chara")) return true; // 再構築するとアニメが頭出しされるので維持
  const box = document.createElement("div");
  box.className = "st-chara";
  box.style.setProperty("--st-aspect", data.aspect);
  box.style.setProperty("--st-bob-origin", data.bob);
  box.style.setProperty("--st-sway-origin", data.sway);
  box.style.setProperty("--st-blink-origin", data.blink);
  box.style.setProperty("--st-blink-tilt", data.blinkTilt || "0deg");
  box.style.setProperty("--st-arm-origin", data.arm);
  for (const f of data.files) {
    const part = f.slice(3); // "00_back_hair" → "back_hair"
    const wrap = document.createElement("div");
    wrap.className = `st-layer ${LIVE_PART_MOTION[part] || ""}`.trim();
    const img = document.createElement("img");
    img.alt = "";
    img.onerror = () => {
      // 連打でポーズを差し替えると読み込み途中のimgがabort→errorになるため、
      // すでにDOMから外れたimgのerrorは無視する（本物の404はDOM接続中に発火する）
      if (!img.isConnected) return;
      // CDNやキャッシュの欠けで一部レイヤーが出ないと絵が壊れるので、丸ごと1枚絵へ退避
      liveCharaBroken = true;
      delete el.dataset.livePose;
      setCharaImage(el, `${trainer().dir}/${pose}.png`, label, 1);
    };
    img.src = `${trainer().dir}/live/${pose}/${f}.webp`;
    wrap.appendChild(img);
    box.appendChild(wrap);
  }
  el.innerHTML = "";
  el.appendChild(box);
  el.dataset.livePose = pose;
  return true;
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
    ? `${n}本 ・ 約${Math.max(1, Math.ceil(totalSec / 60))}分 ・ 約${estimateKcal(workTotal)}kcal（体重60kg想定の概算） ・ +${expForResult(workTotal)}修行値`
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

async function deleteCustom(id: string) {
  const c = customMenus().find((m) => m.id === id);
  if (!c) return;
  if (!await askConfirm({ title: `「${c.title}」を削除する？`, body: "完走の記録は消えません。", ok: "削除する" })) return;
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
      `<small class="kcal-note">（体重60kg想定の概算）</small>` +
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

// ---- サウンド設定（ボイス/BGM個別トグル。2026-07-23）----
// マイページのON/OFFボタン・実行画面のポップオーバー・ヘッダーのアイコンの3箇所を必ず揃える
function syncSoundUI() {
  const voiceOn = !!state.settings.sound;
  const bgmOn = state.settings.bgm !== false;
  const st = $("#set-sound");
  st.classList.toggle("on", voiceOn);
  st.textContent = voiceOn ? "ON" : "OFF";
  const bg = $("#set-bgm");
  bg.classList.toggle("on", bgmOn);
  bg.textContent = bgmOn ? "ON" : "OFF";
  const pv = $("#pop-toggle-voice");
  pv.classList.toggle("on", voiceOn);
  pv.textContent = voiceOn ? "ON" : "OFF";
  const pb = $("#pop-toggle-bgm");
  pb.classList.toggle("on", bgmOn);
  pb.textContent = bgmOn ? "ON" : "OFF";
  $("#sound-icon").setAttribute("class", `sound-icon ${soundIconState(voiceOn, bgmOn)}`);
}

function setVoiceEnabled(on: boolean) {
  state.settings.sound = on;
  Sound.enabled = on;
  Voice.enabled = on;
  if (!on) Voice.stop();
  store.set("settings", state.settings);
  syncSoundUI();
}

function setBgmEnabled(on: boolean) {
  state.settings.bgm = on;
  Bgm.setEnabled(on);
  store.set("settings", state.settings);
  // 設定を戻したときにその場で鳴らす。実行画面ならワークアウト曲、それ以外はタイトル曲
  if (on) Bgm.play($("#screen-run").classList.contains("active") ? "workout" : "title");
  syncSoundUI();
}

// ヘッダーのサウンドアイコンをタップして開く小さなポップオーバー。外側タップで閉じる。
// エンジンは止めない＝ワークアウト進行を妨げない。
function toggleSoundPopover() {
  const pop = $("#sound-popover");
  pop.hidden = !pop.hidden;
  if (!pop.hidden) syncSoundUI();
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
  const recommendMode = state.settings.recommendMode || "sequential";
  document.querySelectorAll<any>("#seg-recommend button").forEach((b) =>
    b.classList.toggle("on", b.dataset.v === recommendMode));
  syncSoundUI();
  $("#set-reminder").value = state.settings.reminderTime || "";
  if (!Native.isNative) {
    $("#reminder-note").textContent = "通知はアプリ版（準備中）で届きます。時刻は保存されます";
  }
  renderHiddenNinjaList();
  show("screen-mypage");
}

// マイページの「非表示にした人」一覧（番付でこっそり非表示にした忍び名の解除リスト）
function renderHiddenNinjaList() {
  const list = hiddenNinjas();
  const wrap = $("#hidden-ninja-list");
  if (!wrap) return;
  if (!list.length) {
    wrap.innerHTML = `<p class="rank-note hidden-ninja-empty">非表示にした人はいないよ</p>`;
    return;
  }
  wrap.innerHTML = list.map((h) =>
    `<div class="hidden-ninja-row">` +
      `<span class="hidden-ninja-name">${escHtml(h.name || "名無しの忍び")}</span>` +
      `<button class="rank-rename-btn" data-id="${escHtml(h.id)}">戻す</button>` +
    `</div>`).join("");
  wrap.querySelectorAll(".rank-rename-btn").forEach((b) => {
    b.onclick = () => {
      unhideNinja(b.dataset.id);
      renderHiddenNinjaList();
      showToast("番付にまた表示するようにしたよ");
    };
  });
}

// アカウント連携カード(Google)はv1でUIを蓋にしたため、状態更新関数ごと撤去済み。
// 将来復活時はcloud.tsのgetIdentityStatus/linkGoogle/signOutGoogleとここのUI配線を戻す。

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
let lastRankRows: any[] | null = null; // 非表示操作で再取得せずに再描画するための直近データ

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
  lastRankRows = rows;
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
  // 忍び名の非表示（ローカルミュート）を適用。改名しても効くようninja_id基準
  const visible = filterHiddenRanking(rows, hiddenNinjas());
  if (!visible.length) {
    $("#rank-list").innerHTML =
      `<p class="rank-note">表示できる番付がありません。<br>マイページの「非表示にした人」から戻せます。</p>`;
    return;
  }
  $("#rank-list").innerHTML = visible.map((r) =>
    `<div class="rank-row${r.is_me ? " me" : ""}">` +
      `<span class="rank-no">${r.rank}</span>` +
      `<span class="rank-name">${escHtml(r.ninja_name)}</span>` +
      `<span class="rank-exp">${r.weekly_exp}<small>修行値</small></span>` +
      (r.is_me ? "" :
        `<button class="rank-hide-btn" data-id="${escHtml(r.ninja_id)}" data-name="${escHtml(r.ninja_name)}" aria-label="この名前を番付から非表示にする" title="この名前を番付から非表示にする">⋯</button>`) +
    `</div>`).join("");
  $("#rank-list").querySelectorAll(".rank-hide-btn").forEach((b) => {
    b.onclick = () => hideRankRow(b.dataset.id, b.dataset.name);
  });
}

// 忍び名を番付から非表示にする（罰しないトーン・自分の画面だけに反映・いつでもマイページから戻せる）
async function hideRankRow(ninjaId: string, name: string) {
  if (!ninjaId) return;
  if (!await askConfirm({ title: `「${name}」を番付から非表示にする？`,
    body: "あなたの画面だけに反映されます。マイページからいつでも戻せます。", ok: "非表示にする" })) return;
  hideNinja(ninjaId, name);
  showToast(`「${name}」を番付から非表示にしたよ`);
  if (lastRankRows) renderRankRows(lastRankRows); // 再取得せず手元のデータで即再描画
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
let lastFriendBoard: any[] | null = null; // 解除操作で再取得せずに再描画するための直近データ
let friendRemovePending = false;          // 多重タップ耐性（連打で二重RPCを飛ばさない）

async function loadFriendsSection() {
  $("#friend-list").innerHTML = `<p class="rank-note">なかまを読み込み中…</p>`;
  const [code, board] = await Promise.all([myFriendCode(), friendsBoard()]);
  if (!$("#screen-ranking").classList.contains("active")) return;
  $("#my-friend-code").textContent = code || "取得できず";
  lastFriendBoard = board;
  renderFriendRows(board);
}

function renderFriendRows(board) {
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
      `<div class="friend-top">` +
        `<span class="friend-name">${escHtml(f.ninja_name)}</span>` +
        (f.done_today ? `<span class="friend-done">今日 完了！</span>` : "") +
        `<span class="friend-exp">${f.weekly_exp}<small>今週</small></span>` +
      `</div>` +
      `<div class="friend-actions">` +
        `<button class="poke-btn" data-id="${f.friend_id}">手裏剣を投げる</button>` +
        `<button class="friend-unfriend-btn" data-id="${f.friend_id}" data-name="${escHtml(f.ninja_name)}">解除</button>` +
      `</div>` +
    `</div>`).join("");
  $("#friend-list").querySelectorAll(".poke-btn").forEach((b) => {
    b.onclick = () => openPokeMenu(b.dataset.id);
  });
  $("#friend-list").querySelectorAll(".friend-unfriend-btn").forEach((b) => {
    b.onclick = () => unfriendRow(b.dataset.id, b.dataset.name);
  });
}

// なかま解除（罰しないトーン：確認ダイアログ→双方向で削除→一覧を即更新）
async function unfriendRow(friendId: string, name: string) {
  if (!friendId || friendRemovePending) return;
  if (!await askConfirm({ title: `「${name}」さんをなかまから外す？`, ok: "外す" })) return;
  friendRemovePending = true;
  try {
    if (!navigator.onLine) { showToast("オフラインです。電波のあるところでもう一度試してね"); return; }
    // 楽観的更新：まず一覧から消して即座に反映し、失敗したら元のデータで復元する
    const before = lastFriendBoard;
    if (lastFriendBoard) {
      lastFriendBoard = removeFriendFromBoard(lastFriendBoard, friendId);
      renderFriendRows(lastFriendBoard);
    }
    const ok = await removeFriend(friendId);
    if (ok) {
      showToast(`「${name}」さんをなかまから外したよ`);
    } else {
      lastFriendBoard = before; // 失敗したら元に戻す
      if (lastFriendBoard) renderFriendRows(lastFriendBoard);
      showToast("解除できなかった…電波を確認してもう一度試してね");
    }
  } finally {
    friendRemovePending = false;
  }
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
  if (r === "ok") {
    markDonePokeSent(target);
    // 投げた側の小判（1日3回まで・2026-07-23ルク決裁）
    let kobanText = "";
    if (canEarnPokeKoban(kobanLedger(), "poke_sent", todayStr())) {
      const e = addKoban(KOBAN_RATES.pokeSent, "poke_sent", target);
      kobanText = ` +${e.delta}小判`;
    }
    showToast(`手裏剣を投げた！相手が次にアプリを開いた時に届くよ 🥷${kobanText}`);
  }
  else if (r === "already_today") showToast("その相手には今日はもう投げたよ。また明日！");
  else showToast("投げられなかった…電波を確認してもう一度");
}

// 完了画面の「まだの仲間へ手裏剣」行を、投げた相手だけ無効表示に変える（二重送信防止）
function markDonePokeSent(friendId: string) {
  const btn = document.querySelector(`#done-poke-list .done-poke-btn[data-id="${friendId}"]`) as any;
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = "投げたよ！";
  btn.classList.add("is-sent");
}

// ウィジェットへ現在の状態を届ける（起動時・完走時）
function pushWidgetState() {
  Native.updateWidget({
    streak: streakDays(),
    doneToday: todayStats().count > 0,
    mission: missionStatus().mission.label,
    koban: kobanBalance(),
    date: todayStr(),
    weekDone: weekDoneArray(state.history), // 週間実施ドット（月〜日7要素）。ホームのweekRecord()と同じ判定基準
  });
}

// 未読の手裏剣が届いていたら、サクヤが知らせる（起動時に呼ぶ）
async function checkPokes() {
  const pokes = await fetchUnseenPokes();
  if (!pokes.length) return;
  const first = pokes[0];
  const msg = POKE_MESSAGES[first.msg_idx] || POKE_MESSAGES[0];
  const extra = pokes.length > 1 ? `（ほか${pokes.length - 1}件）` : "";
  // 受け取った側の小判（1件+2・1日3件まで・2026-07-23ルク決裁）。届いた分だけ上限まで加算する
  const day = todayStr();
  let earned = 0;
  for (const p of pokes) {
    if (!canEarnPokeKoban(kobanLedger(), "poke_received", day)) break;
    earned += addKoban(KOBAN_RATES.pokeReceived, "poke_received", String(p.poke_id)).delta;
  }
  const kobanText = earned > 0 ? ` +${earned}小判` : "";
  showToast(`🥷 ${first.from_name}から手裏剣：「${msg}」${extra}${kobanText}`, 5000);
  try {
    Sound.init();
    if (Sound.unlocked() && state.settings.sound) {   // interruptedでもVoice側で復帰を試みる
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
// 実施判定・週境界そのものはdata.tsのweekDoneArray()を単一ソースとして使う
// （ウィジェットへ渡すweekDoneと定義がズレないように）
function weekRecord() {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // 月=0 … 日=6
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow);
  const done7 = weekDoneArray(state.history, now);
  const todayS = todayStr(now);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const ds = todayStr(d);
    days.push({ label: "月火水木金土日"[i], done: done7[i], isToday: ds === todayS });
  }
  return { days, count: days.filter(d => d.done).length, goal: WEEKLY_GOAL };
}

// ホームの一言：初回・久しぶり（責めない）・連続・時間帯で出し分け
// 戻り値はボイスキー（VOICE_LINESに表示文言、assets/audio/<trainer>/に音声がある）
function homeGreetingKey(): string {
  const completed = state.history.filter(h => h.completed);
  // 「はじめまして」は本当に初回の1回だけ（2026-07-22 ルク指示）。
  // 以前は「完走履歴が0件の間ずっと」だったので、始めるまで何度も言われていた。
  if (completed.length === 0 && !store.get("greeted_first", false)) {
    store.set("greeted_first", true);
    return "greet_first";
  }
  if (completed.length === 0) {
    // まだ1回も完走していない人には、時間帯のあいさつで迎える
    const h = new Date().getHours();
    return h < 10 ? "greet_morning" : (h >= 20 ? "greet_night" : "greet_noon");
  }
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
    `<p class="kcal-note">消費kcalは（体重60kg想定の概算）です</p>` +
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
let homeJoyPose = 2;               // いま表示中のjoyポーズ番号(1〜JOY_POSE_COUNT)

// 音声が解錠済み（＝一度でも操作済み or ネイティブ）なら、ホーム到着時にあいさつを自動発声
function maybeSpeakGreeting() {
  if (greetingAutoSpoken) return;
  try {
    Sound.init(); // 未解錠ならsuspendedのままになるだけで害はない
    if (Sound.unlocked()) {   // interruptedでもVoice側で復帰を試みる
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
  while (n === homeJoyPose) n = 1 + Math.floor(Math.random() * JOY_POSE_COUNT);
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


// メニュー名は一覧・詳細・実行画面で同じ表記に統一している（2026-07-22 ルク指示）。
// ただし一覧カードの文字欄は約90pxしかなく、長い名前（腕立て尽くし等）は「…」で切れてしまう。
// 名前を短縮するのではなく、はみ出すカードだけ字を詰めて収める（下限11pxまで）。
function fitCardTitles() {
  document.querySelectorAll<any>(".hud-card-title").forEach((el) => {
    el.style.fontSize = "";
    for (let fs = parseFloat(getComputedStyle(el).fontSize); el.scrollWidth > el.clientWidth + 1 && fs > 11; fs -= 0.5) {
      el.style.fontSize = `${fs - 0.5}px`;
    }
  });
}

// ---- チュートリアル動画（初回1回だけ案内・以降はマイページからいつでも）----
// 「両方見る」は概要→詳細を続けて再生する。キューが空になったら終了して前の画面へ戻る。
let tutorialQueueRest: string[] = [];
let tutorialReturnScreen = "screen-home";

function playTutorial(key: string) {
  const v = TUTORIAL_VIDEOS[key as keyof typeof TUTORIAL_VIDEOS];
  if (!v) return;
  const el = $("#tutorial-video") as HTMLVideoElement;
  $("#tutorial-title").textContent = `チュートリアル：${v.title}`;
  $("#tutorial-caption").textContent = v.note;
  el.src = v.src;
  el.currentTime = 0;
  el.play().catch(() => { /* 自動再生できない環境ではユーザーが再生ボタンを押す */ });
}

function openTutorial(queue: string[], from = "screen-home") {
  if (!queue.length) return;
  tutorialReturnScreen = from;
  tutorialQueueRest = queue.slice(1);
  show("screen-tutorial");
  playTutorial(queue[0]);
}

function closeTutorial() {
  const el = $("#tutorial-video") as HTMLVideoElement;
  el.pause();
  el.removeAttribute("src");
  el.load();
  tutorialQueueRest = [];
  show(tutorialReturnScreen);
}

// ホーム吹き出しの描画。改行ルールは data.ts の quoteLines() が決める（左寄せ・句読点で折り返し）。
// innerHTMLは使わず要素を組み立てる（セリフは自前の定数だが、描画経路は素直に保つ）
function renderQuote(el, key) {
  const text = VOICE_LINES[key] || "";
  el.textContent = "";
  for (const segs of quoteLines(text)) {
    const row = document.createElement("span");
    row.className = "qrow";
    for (const seg of segs) {
      const s = document.createElement("span");
      s.className = "qseg";
      s.textContent = seg;
      row.appendChild(s);
    }
    el.appendChild(row);
  }
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
    renderQuote(el, key);
  }
  speakHomeLine(homeLineKey);
  el.classList.remove("bubble-pop");
  void el.offsetWidth; // アニメーション再発火
  el.classList.add("bubble-pop");
}

// ---- 昨日の実績＋今日のおすすめ（ホーム上部カード）----
// 純粋関数（data.ts）の結果をDOMへ反映するだけ。タップ遷移用に選ばれたメニューを保持しておく
let recoWorkout: any = null;

function renderRecoCard() {
  const y = yesterdaySummary(state.history);
  $("#reco-yesterday").textContent = y.message;
  const mode = state.settings.recommendMode || "sequential";
  recoWorkout = recommendWorkout(state.history, mode, PRESETS);
  $("#reco-today-desc").textContent = recoWorkout ? `「${recoWorkout.title}」はどう？` : "";
}

// ---- ホーム画面 ----
function renderHome() {
  stopCatalog();
  Bgm.play("title");   // ホーム＝タイトル曲（ユーザー操作前は再生が拒否されるので、次のタップで鳴る）
  homeLineKey = homeGreetingKey();
  // ヒーローカードは「迎えてくれる」joyポーズ。3日以上あいた「おかえり」の時だけ、
  // 両腕を広げた歓迎ポーズ(joy_5)で迎える（2026-07-23ルク指示・2026-07-24レイヤーアニメ完成で復帰）
  homeJoyPose = homeLineKey === "greet_comeback" ? 5 : 2;
  showPose($("#home-chara"), `joy_${homeJoyPose}`, trainer().name);
  homeGreetingSpoken = false;
  renderQuote($("#home-quote"), homeLineKey);
  maybeSpeakGreeting();
  for (let i = 1; i <= JOY_POSE_COUNT; i++) new Image().src = `${trainer().dir}/joy_${i}.png`;
  // タップ切替時のチラつき防止：レイヤー版アセット（1ポーズ約60KB）も先読み
  const livePoses = LIVE_POSES[trainer().dir] || {};
  for (const [p, d] of Object.entries<any>(livePoses)) {
    for (const f of d.files) new Image().src = `${trainer().dir}/live/${p}/${f}.webp`;
  }
  renderStatusCard();
  renderRecoCard();
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
  fitCardTitles();
  const tc = todayStats().count;
  const ms = missionStatus();
  $("#hud-ch-desc").textContent = ms.done
    ? `${ms.mission.label} ── クリア！ ✓`
    : `${ms.mission.label}（＋${MISSION_BONUS_EXP}修行値）`;
  $("#hud-challenge").classList.toggle("cleared", ms.done);
  show("screen-home");
}

// 実働時間を「◯分◯秒」（1分未満は「◯秒」）で表示
function fmtMinSec(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60), sc = s % 60;
  return m > 0 ? `${m}分${sc}秒` : `${sc}秒`;
}

// 履歴1件のメニュー名：workoutId→PRESETS.title、消えたメニュー(カスタム削除済み等)は
// 完走時点の記録(entry.title)、それも無ければ「クイック」
function historyMenuTitle(h: HistoryEntry): string {
  return PRESETS.find((p) => p.id === h.workoutId)?.title || h.title || "クイック";
}

const escHtml = (t: any) => String(t).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c]);

// ---- 実施履歴（修行の記録）----
function renderHistory() {
  show("screen-history");
  $("#history-total").textContent = String(state.history.filter((h) => h.completed).length);
  $("#history-week").textContent = String(weekRecord().count);
  $("#history-exp").textContent = String(totalExp());
  $("#history-streak").textContent = String(streakDays());

  const wrap = $("#history-list");
  const items = [...state.history].sort((a, b) => (b.ts || 0) - (a.ts || 0)); // 日付降順（ts基準）
  if (!items.length) {
    wrap.innerHTML = `<p class="rank-note">まだ記録がないよ。最初の4分、いっしょに始めよう。</p>`;
    return;
  }
  wrap.innerHTML = items.map((h) => {
    const d = new Date(h.date + "T00:00:00");
    const dateLabel = `${d.getMonth() + 1}/${d.getDate()}(${"日月火水木金土"[d.getDay()]})`;
    const gained = expForResult(h.totalWorkSec) + (h.bonusExp || 0);
    return `<div class="rank-row hist-row">` +
      `<span class="hist-date">${dateLabel}</span>` +
      `<span class="hist-info"><b>${escHtml(historyMenuTitle(h))}</b>` +
        `<small>${fmtMinSec(h.totalWorkSec)} ・ 約${estimateKcal(h.totalWorkSec)}kcal（体重60kg想定の概算）</small></span>` +
      (h.completed
        ? `<span class="hist-exp">+${gained}<small>修行値</small></span>`
        : `<span class="hist-exp hist-exp-quit">中断</span>`) +
      `<span class="hist-badge${h.completed ? " hist-badge-done" : " hist-badge-quit"}">` +
        `${h.completed ? "🎉" : "⏸"}</span>` +
    `</div>`;
  }).join("");
}

// ---- ワークアウト実行 ----
function startWorkout(workout) {
  autoPausedByVisibility = false;
  $("#sound-popover").hidden = true; // 前回の開きっぱなしを持ち越さない
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
      "half_1", "half_2", "hold10_1", "finisher_plank",
      ...exKeys.map((k) => `first_${k}`), ...exKeys.map((k) => `next_${k}`),
      ...exKeys.map((k) => `last_${k}`)]),
    ...(cheerMany ? ["go_1", "go_2", "mid_1", "mid_2", "mid_3"] : []),
  ]);
  acquireWakeLock();
  state.currentWorkout = workout;

  let lastTickSec = null;

  const engine = new WorkoutEngine(workout, state.settings.prepareSec, {
    onSegmentChange(seg, next) {
      // レスト中の上部バナーは「休憩」固定。次の種目は中央セリフ（つぎは、◯◯！）が予告する
      // （2026-07-23ルク指示。nextStyleはセリフの出し分けに引き続き使用）
      const nextStyle = !next ? null : next.finisher ? "finisher" : (next.slot === next.total ? "last" : "next");
      const restLabel = restBannerLabel();
      const label = { prepare: "準備して！", work: EXERCISES[seg.exercise].name, rest: restLabel }[seg.type];
      $("#run-phase").innerHTML =
        `<img class="run-phase-ico" src="assets/ui/icons/phase-${seg.type}.jpg" alt="">${label}`;
      $("#run-progress").textContent = `エクササイズ ${seg.slot}/${seg.total}`;
      $("#screen-run").className = `screen hud active phase-${seg.type}`;
      // レスト中は上部バナー＋中央セリフで種目名が出るため、下部は非表示にして重複を減らす
      $("#run-next").textContent = runNextLabel(seg.type, next);

      // 準備・休憩中は次にやる種目のお手本を先に見せる（タバタ方式）
      playSprite($("#run-chara"), seg.exercise);

      $("#run-quote").textContent = "";
      if (seg.type === "work") {
        Sound.workStart();
        if (cheerMany) say(["go_1", "go_2"]);                   // 「いくよっ！」（種目名は直前に予告済み）
      } else if (seg.type === "rest") {
        Sound.restStart();
        if (next && !cheerFew) {
          if (nextStyle === "finisher") {
            Voice.play("finisher_plank");                       // 「仕上げは、プランク！」
            $("#run-quote").textContent = VOICE_LINES.finisher_plank;
          } else if (nextStyle === "last") {
            Voice.play(`last_${next.exercise}`);                // 「最後は、〇〇！」
            $("#run-quote").textContent = voiceLineLast(next.exercise);
          } else {
            Voice.play(`next_${next.exercise}`);                // 「つぎは、〇〇！」
            $("#run-quote").textContent = voiceLineNext(next.exercise);
          }
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
        if (seg.type === "work" && seg.sec >= 30 && !cheerFew) {
          // ロングワーク（プランク60秒等）: 経過10秒「まだ10秒」→ 中間「はんぶん来たよ！」
          const elapsed = seg.sec - sec;
          if (elapsed === 10 && seg.sec >= 45) say(["hold10_1"]);
          if (sec === Math.ceil(seg.sec / 2)) say(["half_1", "half_2"]);
        } else if (seg.type === "work" && sec === 14 && seg.sec > 15 && cheerMany) {
          // 20秒ワークの中盤応援は「多め」のみ（中間=10秒はラスト10秒と衝突するため14秒地点）
          say(["mid_1", "mid_2", "mid_3"]);
        }
      }
    },

    async onFinish() {
      autoPausedByVisibility = false;
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
  setPauseButtonUI(false);
  Bgm.play("workout");
  show("screen-run");
  engine.start();
}

// 一時停止ボタン（ルク選定＝案2「静かなオーロラリング」）。
// 暗い芯＋白の細縁＋青緑グラデの回転リング。二本線↔三角は同じSVG内に両方置き、
// aria-pressed（=一時停止中）でCSSがクロスフェードする＝毎回innerHTMLを組み直さない。
// 新規のAI画像生成はなし＝SVGで完結。明るいhud背景でも暗い実行画面でも輪郭が沈まない。
const PAUSE_BUTTON_SVG =
  `<svg viewBox="0 0 96 96" aria-hidden="true" focusable="false">` +
  `<defs><linearGradient id="pauseAuraStroke" x1="18" y1="16" x2="78" y2="80" gradientUnits="userSpaceOnUse">` +
  `<stop stop-color="#a6fff1"/><stop offset=".5" stop-color="#5fc8ff"/><stop offset="1" stop-color="#ffd0bf"/>` +
  `</linearGradient></defs>` +
  `<circle class="aura-inner" cx="48" cy="48" r="33"/>` +
  `<circle class="halo" cx="48" cy="48" r="33"/>` +
  `<circle class="aura-ring" cx="48" cy="48" r="39"/>` +
  `<g class="pause-icon">` +
  `<rect class="mark" x="36" y="31" width="8" height="34" rx="4"/>` +
  `<rect class="mark" x="52" y="31" width="8" height="34" rx="4"/></g>` +
  `<g class="play-icon"><path class="mark" d="M39 30 67 48 39 66Z"/></g></svg>`;

function setPauseButtonUI(paused: boolean) {
  const s = pauseButtonState(paused);
  const btn = $("#btn-pause");
  if (!btn) return;
  if (!btn.querySelector("svg")) btn.innerHTML = PAUSE_BUTTON_SVG;
  btn.setAttribute("aria-pressed", paused ? "true" : "false");
  btn.setAttribute("aria-label", s.label);
}

// バックグラウンド復帰(visibilitychange)でも手動ボタンと同じ経路を通す共通ヘルパー
// autoPausedByVisibility: hiddenで自動pauseした場合だけvisible復帰で自動resumeする
// （ユーザーが手動でpauseした状態のままバックグラウンドへ行った場合は、戻ってきても勝手に再開しない）
let autoPausedByVisibility = false;

function pauseEngine() {
  const e = state.engine;
  if (!e || e.finished || e.pausedAt !== null) return;
  e.pause();
  Voice.stop();
  Sound.stopAll();
  Bgm.pause();
  $("#run-chara video")?.pause();
  setPauseButtonUI(true);
}

function resumeEngine() {
  const e = state.engine;
  if (!e || e.finished || e.pausedAt === null) return;
  e.resume();
  Bgm.resume();
  playSprite($("#run-chara"), e.current.exercise);
  ensureVideoPlaying($("#run-chara video"));   // 同じ種目だとsrcが変わらずload()が走らないため
  setPauseButtonUI(false);
}

function togglePause() {
  const e = state.engine;
  if (!e || e.finished) return;
  if (e.pausedAt === null) pauseEngine();
  else resumeEngine();
}

// 汎用の確認ダイアログ。window.confirm()はネイティブ（Capacitor WKWebView）で無反応になることが
// あり、実機で「削除できない」「解除できない」と見える（2026-07-23 UT D-2/E-2の既知リスク）。
// 中断だけ先にモーダル化してあったので、残っていた削除・非表示・なかま解除も同じ土台へ寄せる。
let confirmResolve: ((v: boolean) => void) | null = null;
function askConfirm(o: { title: string; body?: string; ok?: string; cancel?: string }): Promise<boolean> {
  $("#confirm-title").textContent = o.title;
  const body = $("#confirm-body");
  body.textContent = o.body || "";
  body.hidden = !o.body;
  $("#btn-confirm-ok").textContent = o.ok || "はい";
  $("#btn-confirm-cancel").textContent = o.cancel || "やめておく";
  $("#confirm-modal").hidden = false;
  return new Promise((resolve) => { confirmResolve = resolve; });
}
function closeConfirm(answer: boolean) {
  $("#confirm-modal").hidden = true;
  const r = confirmResolve;
  confirmResolve = null;
  if (r) r(answer);
}

// window.confirm()はネイティブ（Capacitor WKWebView）で機能しないことがあり、
// 「←」で中断できなくなる実機バグの原因だった。アプリ内モーダルに置き換える（2026-07-23）。
function quitWorkout() {
  $("#quit-modal").hidden = false;
}
function closeQuitModal() {
  $("#quit-modal").hidden = true;
}
function confirmQuitWorkout() {
  closeQuitModal();
  state.engine?.stop();
  autoPausedByVisibility = false;
  Voice.stop();
  $("#run-chara video")?.pause();
  releaseWakeLock();
  renderHome();
}

// ---- 完了画面 ----
const JOY_POSE_COUNT = 5; // joy_1〜joy_5 を完走のたびに順番に使う（joy_5＝おかえりの歓迎ポーズ）
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
  // 今日やったメニューの中身（種目サムネの並び）を見せる
  const w = state.currentWorkout;
  if (w) {
    const plankSec = state.settings.plankSec || 0;
    const thumbs = w.exercises.map((key) =>
      `<div class="done-ex"><img src="${trainer().thumbDir}/${key}.jpg" alt="">` +
      `<span>${EXERCISES[key].name}</span></div>`).join("") +
      (plankSec > 0
        ? `<div class="done-ex done-ex-fin"><img src="${trainer().thumbDir}/plank.jpg" alt=""><span>仕上げ</span></div>`
        : "");
    $("#done-menu").innerHTML =
      `<div class="done-menu-head"><img src="${presetIconSrc(w)}" alt="">` +
      `<b>${w.title}</b><small>${w.exercises.length}種目 × ${w.rounds}周 ・ ワーク${w.workSec}秒</small></div>` +
      `<div class="done-ex-strip">${thumbs}</div>`;
  } else {
    $("#done-menu").innerHTML = "";
  }

  $("#done-stats").innerHTML =
    `<li>${workout.title} 完走 🎉</li>` +
    `<li>運動時間 ${Math.round(totalWorkSec / 60 * 10) / 10}分 ・ 約${estimateKcal(totalWorkSec)}kcal（体重60kg想定の概算）</li>` +
    `<li>🥷 ${rankAfter.name} ・ +${gained} 修行値</li>` +
    `<li><img class="koban-ico" src="assets/ui/icons/koban.jpg" alt="">+${state.lastKobanEarned || 0} 小判（計 ${kobanBalance()}）</li>` +
    (missionCleared ? `<li>🚩 今日の任務クリア！（＋${MISSION_BONUS_EXP}修行値込み）</li>` : "") +
    (state.lastStreakBonus ? `<li>🔥 連続${streakDays()}日ボーナス ＋${state.lastStreakBonus}修行値込み</li>` : "") +
    `<li>${s > 0 ? `🔥 ${s}日連続` : "また明日も待ってるよ"}</li>`;
  const text = encodeURIComponent(
    `${trainer().name}と一緒に「${workout.title}」完走した！🥷 #4分筋トレ #CryptoNinja`);
  $("#btn-share").href = `https://twitter.com/intent/tweet?text=${text}`;
  show("screen-done");
  renderDonePokeSection();
}

// 完了画面「まだの仲間へ手裏剣」（2026-07-23）。非同期取得なので renderDone 本体は待たせず後から差し込む。
async function renderDonePokeSection() {
  const wrap = $("#done-poke");
  const list = $("#done-poke-list");
  wrap.hidden = true;
  list.innerHTML = "";
  const board = await friendsBoard();
  if (!$("#screen-done").classList.contains("active")) return; // 取得中に画面を離れていたら反映しない
  const targets = pokeableFriends(board);
  if (!targets.length) return;
  list.innerHTML = targets.map((f) =>
    `<div class="done-poke-row">` +
      `<span class="done-poke-name">${escHtml(f.ninja_name)}</span>` +
      `<button class="done-poke-btn" data-id="${f.friend_id}">手裏剣を投げる 🥷</button>` +
    `</div>`).join("");
  list.querySelectorAll(".done-poke-btn").forEach((b: any) => {
    b.onclick = () => openPokeMenu(b.dataset.id);
  });
  wrap.hidden = false;
}

// ---- 完了画面のシェア画像（2026-07-23ルク指示）----
// 画面のスクショではなく、Xに貼って映える1枚絵をキャンバスで描き起こす。
// 内容は完了画面と同じ（サクヤ／セリフ／メニューと種目サムネ／記録）。
const SHARE_W = 1080, SHARE_H = 1350;

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`load failed: ${src}`));
    img.src = src;
  });
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 画像を指定枠にcoverで描く（アスペクト比を保ったまま枠を埋める）
function drawCover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

async function buildShareImageBlob(): Promise<Blob> {
  const cv = document.createElement("canvas");
  cv.width = SHARE_W; cv.height = SHARE_H;
  const ctx = cv.getContext("2d");
  const FONT = '"M PLUS Rounded 1c", system-ui, sans-serif';
  try { await (document as any).fonts?.ready; } catch { /* フォント未対応環境は既定フォントで描く */ }

  // 背景（読み込めない場合はアプリ配色のグラデで代替）
  try {
    const bg = await loadImg("assets/ui/background.jpg");
    drawCover(ctx, bg, 0, 0, SHARE_W, SHARE_H);
  } catch {
    const g = ctx.createLinearGradient(0, 0, 0, SHARE_H);
    g.addColorStop(0, "#c7d6ee"); g.addColorStop(1, "#aabfe0");
    ctx.fillStyle = g; ctx.fillRect(0, 0, SHARE_W, SHARE_H);
  }
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);

  // サクヤ（完了画面に出ている絵をそのまま使う）
  const charaSrc = ($("#done-chara img") as HTMLImageElement)?.getAttribute("src");
  let y = 56;
  if (charaSrc) {
    try {
      const chara = await loadImg(charaSrc);
      const h = 540, w = chara.width * (h / chara.height);
      ctx.save();
      ctx.shadowColor = "rgba(31,42,68,0.28)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 14;
      ctx.drawImage(chara, (SHARE_W - w) / 2, y, w, h);
      ctx.restore();
      y += h + 18;
    } catch { y += 40; }
  }

  // セリフ吹き出し
  const quote = $("#done-quote").textContent.trim();
  if (quote) {
    const size = fitFontSize(quote, SHARE_W - 260, 46, 30,
      (t, s) => { ctx.font = `700 ${s}px ${FONT}`; return ctx.measureText(t).width; });
    ctx.font = `700 ${size}px ${FONT}`;
    const bw = Math.min(SHARE_W - 120, ctx.measureText(quote).width + 90), bh = 104;
    const bx = (SHARE_W - bw) / 2;
    ctx.save();
    ctx.shadowColor = "rgba(31,42,68,0.20)"; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
    ctx.fillStyle = "#fff";
    roundRectPath(ctx, bx, y, bw, bh, 34);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#1f2a44"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(quote, SHARE_W / 2, y + bh / 2);
    y += bh + 26;
  }

  // メニューカード（タイトル＋種目サムネ）
  const w0 = state.currentWorkout;
  if (w0) {
    const keys = [...w0.exercises, ...((state.settings.plankSec || 0) > 0 ? ["plank"] : [])].slice(0, 8);
    const cx = 60, cw = SHARE_W - 120;
    // サムネは上限128pxで、種目が少ない時も大きくなりすぎないようにして中央寄せする
    const n = keys.length, gap = 12;
    const tw = Math.min(128, Math.floor((cw - 52 - gap * (n - 1)) / n));
    const rowW = n * tw + gap * (n - 1);
    const rowX = cx + (cw - rowW) / 2;
    const cardH = 108 + tw + 40;
    ctx.save();
    ctx.shadowColor = "rgba(50,74,120,0.18)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10;
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    roundRectPath(ctx, cx, y, cw, cardH, 28);
    ctx.fill();
    ctx.restore();
    // ヘッダー行
    try {
      const ico = await loadImg(presetIconSrc(w0));
      ctx.save();
      roundRectPath(ctx, cx + 26, y + 22, 64, 64, 16);
      ctx.clip();
      ctx.drawImage(ico, cx + 26, y + 22, 64, 64);
      ctx.restore();
    } catch { /* アイコンが無い場合は文字だけで成立させる */ }
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#1f2a44"; ctx.font = `800 42px ${FONT}`;
    ctx.fillText(w0.title, cx + 106, y + 46);
    ctx.fillStyle = "#4a5578"; ctx.font = `700 26px ${FONT}`;
    ctx.fillText(`${w0.exercises.length}種目 × ${w0.rounds}周 ・ ワーク${w0.workSec}秒`, cx + 106, y + 80);
    // 種目サムネ
    for (let i = 0; i < n; i++) {
      const tx = rowX + i * (tw + gap), ty = y + 108;
      try {
        const th = await loadImg(`${trainer().thumbDir}/${keys[i]}.jpg`);
        ctx.save();
        roundRectPath(ctx, tx, ty, tw, tw, 14);
        ctx.clip();
        drawCover(ctx, th, tx, ty, tw, tw);
        ctx.restore();
      } catch {
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        roundRectPath(ctx, tx, ty, tw, tw, 14); ctx.fill();
      }
      const name = EXERCISES[keys[i]].name.replace(/​/g, "");
      ctx.fillStyle = "#4a5578"; ctx.textAlign = "center";
      const ns = fitFontSize(name, tw + 6, 20, 12,
        (t, s) => { ctx.font = `700 ${s}px ${FONT}`; return ctx.measureText(t).width; });
      ctx.font = `700 ${ns}px ${FONT}`;
      ctx.fillText(name, tx + tw / 2, ty + tw + 18);
    }
    y += cardH + 26;
  }

  // 記録（完了画面の行をそのまま使う。小判行は画像の代わりに絵文字を置く）
  const lines = [...$("#done-stats").querySelectorAll("li")].map((li: any) =>
    (li.querySelector("img") ? "🪙 " : "") + li.textContent.trim());
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const line of lines) {
    if (y > SHARE_H - 150) break;
    const size = fitFontSize(line, SHARE_W - 140, 34, 22,
      (t, s) => { ctx.font = `700 ${s}px ${FONT}`; return ctx.measureText(t).width; });
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(line, SHARE_W / 2 + 1, y + 25);
    ctx.fillStyle = "#1f2a44";
    ctx.fillText(line, SHARE_W / 2, y + 24);
    y += 50;
  }

  // フッター
  ctx.font = `800 30px ${FONT}`;
  ctx.fillStyle = "rgba(31,42,68,0.72)";
  ctx.fillText(`${trainer().name}と4分筋トレ　#4分筋トレ #CryptoNinja`, SHARE_W / 2, SHARE_H - 46);

  return new Promise((resolve, reject) => {
    cv.toBlob((b) => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png");
  });
}

// クリップボードへコピー。iOS Safari/WKWebViewはユーザー操作と同じタスクで
// ClipboardItemを作る必要があるため、Blobは「Promiseのまま」渡す
async function copyShareImage() {
  const btn = $("#btn-copy-image") as HTMLButtonElement;
  btn.disabled = true;
  try {
    if (navigator.clipboard && "write" in navigator.clipboard && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": buildShareImageBlob() })]);
      showToast("画像をコピーしたよ！Xに貼りつけてね");
      return;
    }
    throw new Error("clipboard image unsupported");
  } catch {
    // フォールバック：共有シート（iOS）→ それも無理ならダウンロード
    try {
      const blob = await buildShareImageBlob();
      const name = shareImageFileName(state.currentWorkout?.title || "workout", new Date().toISOString());
      const file = new File([blob], name, { type: "image/png" });
      if ((navigator as any).canShare?.({ files: [file] })) {
        await (navigator as any).share({ files: [file] });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
      showToast("画像を保存したよ");
    } catch {
      showToast("画像を作れなかった…もう一度試してね");
    }
  } finally {
    btn.disabled = false;
  }
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
  $("#btn-quit-confirm").onclick = confirmQuitWorkout;
  $("#btn-quit-cancel").onclick = closeQuitModal;
  $("#btn-confirm-ok").onclick = () => closeConfirm(true);
  $("#btn-confirm-cancel").onclick = () => closeConfirm(false);
  // 外側（すりガラス部分）のタップは「やめておく」扱い＝破壊的な操作を誤爆させない
  $("#confirm-modal").onclick = (e) => { if (e.target === $("#confirm-modal")) closeConfirm(false); };
  $("#btn-done-home").onclick = renderHome;
  $("#btn-copy-image").onclick = copyShareImage;
  $("#btn-catalog").onclick = renderCatalog;
  $("#btn-catalog-back").onclick = renderHome;
  $("#btn-detail-back").onclick = detailBack;
  $("#hud-mypage-link").onclick = renderMypage;
  $("#btn-mypage-back").onclick = renderHome;
  $("#btn-history-link").onclick = renderHistory;
  $("#btn-history-back").onclick = renderMypage;
  $("#reco-today").onclick = () => { if (recoWorkout) openDetail(recoWorkout, "home"); };
  // Googleアカウント連携ボタン(#btn-link-google/#btn-signin-google/#btn-logout-google)は
  // v1でUIを蓋にしたためindex.htmlから撤去済み・配線もなし。
  // 将来復活時はcloud.tsのlinkGoogle/signOutGoogleと合わせてここに戻す。
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
  document.querySelectorAll<any>("#seg-recommend button").forEach((b) => {
    b.onclick = () => {
      state.settings.recommendMode = b.dataset.v;
      store.set("settings", state.settings);
      renderMypage();
      showToast(b.dataset.v === "random_undone"
        ? "おすすめをランダム（やってないメニュー優先）にしたよ"
        : "おすすめを順繰りにしたよ");
    };
  });
  $("#set-sound").onclick = () => setVoiceEnabled(!state.settings.sound);
  $("#set-bgm").onclick = () => setBgmEnabled(!state.settings.bgm);
  $("#btn-buy-shield").onclick = buyShield;
  $("#set-reminder").onchange = async (e) => {
    state.settings.reminderTime = e.target.value || "";
    store.set("settings", state.settings);
    const r = await Native.syncReminder(state.settings.reminderTime, todayStats().count > 0, streakDays());
    if (r === "denied") showToast("通知が許可されていません。端末の設定から許可してね");
    else if (state.settings.reminderTime) showToast(`毎日 ${state.settings.reminderTime} にサクヤが誘いに来るよ 🔔`);
    else showToast("リマインダーをオフにしたよ");
  };
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
  // サウンドアイコン：タップでボイス/BGM個別トグルの小さなポップオーバーを開く（2026-07-23）
  Bgm.enabled = state.settings.bgm !== false;   // 既存ユーザー（設定に項目がない）も既定ON
  $("#btn-sound").onclick = (e) => {
    e.stopPropagation(); // documentのクリック監視で即閉じないように
    toggleSoundPopover();
  };
  $("#pop-toggle-voice").onclick = (e) => { e.stopPropagation(); setVoiceEnabled(!state.settings.sound); };
  $("#pop-toggle-bgm").onclick = (e) => { e.stopPropagation(); setBgmEnabled(!state.settings.bgm); };
  document.addEventListener("click", () => {
    const pop = $("#sound-popover");
    if (!pop.hidden) pop.hidden = true;
  });
  syncSoundUI();
  setPauseButtonUI(false); // 実行画面に入る前の初期状態（絵文字の一瞬表示を避ける）

  // 初回起動時の健康注意モーダル（マイページからいつでも再表示可）
  $("#btn-health-ack").onclick = () => {
    store.set("health_notice_ack", true);
    $("#health-modal").hidden = true;
    maybeAskTutorial();   // 健康注意を読み終えてから、チュートリアルの案内を出す（重ならないように）
  };
  $("#btn-health-notice-link").onclick = () => { $("#health-modal").hidden = false; };

  // クレジット：マイページ「このアプリについて」からいつでも見られる。
  // 外側（すりガラス）タップとボタンの両方で閉じる（confirm-modalと同じ作法）
  $("#btn-credits-link").onclick = () => { $("#credits-modal").hidden = false; };
  $("#btn-credits-close").onclick = () => { $("#credits-modal").hidden = true; };
  $("#credits-modal").onclick = (e) => { if (e.target === $("#credits-modal")) $("#credits-modal").hidden = true; };
  if (shouldShowHealthNotice(store.get("health_notice_ack", false))) {
    $("#health-modal").hidden = false;
  }

  // チュートリアル動画：初回起動時に1回だけ聞く（選んでも選ばなくても、二度と出さない）
  const tutorialAck = () => store.set("tutorial_prompt_ack", true);
  const closeTutorialModal = () => { $("#tutorial-modal").hidden = true; };
  $("#btn-tut-overview").onclick = () => { tutorialAck(); closeTutorialModal(); openTutorial(tutorialQueue("overview")); };
  $("#btn-tut-detail").onclick = () => { tutorialAck(); closeTutorialModal(); openTutorial(tutorialQueue("detail")); };
  $("#btn-tut-both").onclick = () => { tutorialAck(); closeTutorialModal(); openTutorial(tutorialQueue("both")); };
  $("#btn-tut-skip").onclick = () => { tutorialAck(); closeTutorialModal(); };
  $("#btn-tutorial-link").onclick = () => openTutorial(["overview"], "screen-mypage");
  $("#btn-tut-play-overview").onclick = () => { tutorialQueueRest = []; playTutorial("overview"); };
  $("#btn-tut-play-detail").onclick = () => { tutorialQueueRest = []; playTutorial("detail"); };
  $("#btn-tutorial-back").onclick = closeTutorial;
  ($("#tutorial-video") as HTMLVideoElement).addEventListener("ended", () => {
    const next = tutorialQueueRest.shift();
    if (next) playTutorial(next); // 「両方見る」の2本目へ
  });
  // 動画が未配置のうちは初回モーダルもマイページの導線も出さない（未完成の動画を触らせない）
  $("#btn-tutorial-link").hidden = !TUTORIAL_READY;
  function maybeAskTutorial() {
    if (!$("#health-modal").hidden) return;   // 健康注意が出ている間は待つ
    if (shouldShowTutorialPrompt(store.get("tutorial_prompt_ack", false), TUTORIAL_READY)) {
      $("#tutorial-modal").hidden = false;
    }
  }
  maybeAskTutorial();

  // ホームのバージョン表示：package.jsonのversionがViteのdefineで注入される
  // パッチ番号まで出す（実機でどのビルドが動いているか切り分けるため。2026-07-23）
  $("#app-version").textContent = `v${__APP_VERSION__}`;
  recordFirstLaunch();

  // 開発時のみ：コンソールからの動作確認用フック（本番ビルドでは消える）
  if (import.meta.env.DEV) {
    (window as any).__dbg = {
      state, startWorkout, renderCatalog, renderHome, renderDone, saveResult, Voice, nextHomeQuote, Sound, Bgm,
      flags: () => ({ homeGreetingSpoken, greetingAutoSpoken, homeLineKey }),
      // FIX-1/2/4/6 のヘッドレス検証用（クラウド未接続でもUIだけ確認できるようにする）
      renderFriendRows, renderRankRows, renderHiddenNinjaList, renderMypage, renderHistory, openDetail,
      store, setPauseButtonUI, pauseEngine, resumeEngine,
      // renderRanking/loadFriendsSection(実クラウド通信)を経由せずに、hideRankRow/unfriendRowが
      // 参照するモジュール内キャッシュ(lastRankRows/lastFriendBoard)だけをテスト用に注入するフック
      setTestCache(rankRows, friendBoard) {
        if (rankRows !== undefined) { lastRankRows = rankRows; renderRankRows(rankRows); }
        if (friendBoard !== undefined) { lastFriendBoard = friendBoard; renderFriendRows(friendBoard); }
      },
    };
  }

  // バックグラウンド/非表示タブ対策：rAFではなくsetInterval+絶対時刻基準のタイマーだが、
  // 非表示中はJS自体が止まる（特にiOSネイティブ）ため、hiddenで明示的にpause・visibleで
  // 復帰した時だけresumeする（＝バックグラウンド中は進行を止める。罰しない設計）。
  // 手動pauseボタンで既に止めている場合はここでは触らず、visible復帰でも勝手に再開しない。
  document.addEventListener("visibilitychange", () => {
    const e = state.engine;
    if (document.visibilityState === "hidden") {
      if (e && !e.finished && e.pausedAt === null) {
        pauseEngine();
        autoPausedByVisibility = true;
      }
      // アプリを離れたらBGMと声は必ず止める。裏で鳴り続けると
      // PodcastなどをBGM代わりに聴けない（2026-07-23ルク指示）
      Bgm.pause();
      Voice.stop();
      Sound.stopAll();   // 予約済みの効果音も取り消す（離脱後に鳴るのを防ぐ）
    } else if (document.visibilityState === "visible") {
      if (autoPausedByVisibility) {
        resumeEngine();
        autoPausedByVisibility = false;
      } else {
        Bgm.resume();   // ワークアウト中の復帰はresumeEngine側でBGMも戻る
      }
      // 復帰時にAudioContextがinterruptedのまま残ることがある（他アプリ再生・電話など）
      Sound.ensureRunning();
      // 実行中なら、止まって見えるお手本動画を鳴らし直す（手動一時停止中は触らない）
      if (state.engine && !state.engine.finished && state.engine.pausedAt === null) {
        ensureVideoPlaying($("#run-chara video"));
      }
      if (state.engine && !state.engine.finished) acquireWakeLock();
    }
  });
  // visibilitychangeが来ないままプロセスが止まる経路（スワイプ終了・電源断など）の保険
  window.addEventListener("pagehide", () => { Bgm.pause(); Voice.stop(); Sound.stopAll(); });

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
  // Google連携UIはv1で蓋にしたが、万一URLにOAuth戻りパラメータが付いていても
  // エラーを出さず無害に握りつぶす（ensureSignedInのgetSession呼び出しでsupabase-jsの
  // detectSessionInUrlがURL中のcode/tokenを消費するだけで、UI操作は発生しない）
  if (isOAuthReturnUrl(location.search, location.hash)) {
    ensureSignedIn().then(() => { syncNow(state.history); checkPokes(); });
  } else {
    setTimeout(() => { syncNow(state.history); checkPokes(); }, 3000);
  }
});
