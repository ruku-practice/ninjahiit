// NinjaHIIT アプリ本体：画面管理・スプライト再生・記録

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem("ninjahiit_" + key)) ?? fallback; }
    catch { return fallback; }
  },
  set(key, value) { localStorage.setItem("ninjahiit_" + key, JSON.stringify(value)); },
};

const state = {
  settings: store.get("settings", DEFAULT_SETTINGS),
  history: store.get("history", []),
  engine: null,
  spriteTimer: null,
  catalogTimers: [],
  wakeLock: null,
  missingImages: new Set(),
  missingVideos: new Set(),
};

const trainer = () => TRAINERS[state.settings.trainer];
const $ = (sel) => document.querySelector(sel);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const quote = (key, vars = {}) =>
  pick(trainer().quotes[key]).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

// ---- 画面遷移 ----
function show(screenId) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
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

// ---- お手本再生（ループ動画優先、なければコマ送りスプライト） ----
// video要素はコンテナごとに1つだけ作って使い回す（自動再生ポリシー対策：
// 開始タップで再生許可を得た要素なら、以後のsrc差し替え＋play()が許可される）
function playSprite(el, exerciseKey) {
  stopSprite();
  const src = `${trainer().videoDir}/${exerciseKey}.mp4`;
  if (state.missingVideos.has(src)) {
    playSpriteFrames(el, exerciseKey);
    return;
  }
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
    state.missingVideos.add(src);
    playSpriteFrames(el, exerciseKey);
  };
  if (video.dataset.src !== src) {
    video.dataset.src = src;
    video.src = src;
  }
  // src差し替え直後は読み込み中でplay()が拒否されるため、まず即時に試し、
  // 失敗したら再生可能になった時点でもう一度再生する
  const tryPlay = () => video.play().catch(() => {});
  tryPlay();
  video.addEventListener("canplay", tryPlay, { once: true });
}

function playSpriteFrames(el, exerciseKey) {
  const ex = EXERCISES[exerciseKey];
  const seq = ex.seq || Array.from({ length: ex.frames }, (_, i) => i + 1);
  let i = 0;
  const draw = () => {
    setCharaImage(el, `${trainer().dir}/${exerciseKey}_${seq[i]}.png`, ex.name, seq[i]);
    i = (i + 1) % seq.length;
  };
  draw();
  state.spriteTimer = setInterval(draw, ex.frameMs);
}

function showPose(el, pose, label) {
  stopSprite();
  setCharaImage(el, `${trainer().dir}/${pose}.png`, label, 1);
}

function stopSprite() {
  if (state.spriteTimer) { clearInterval(state.spriteTimer); state.spriteTimer = null; }
}

// ---- ワークアウト一覧（種目の動きを確認できるカタログ画面） ----
// サムネイルもお手本ループ動画で見せる。20個同時再生は重いので、
// IntersectionObserverで画面内のサムネイルだけ src をロード＋再生する
let catalogObserver = null;

function ensureCatalogObserver() {
  if (catalogObserver) return;
  catalogObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const v = entry.target;
      if (entry.isIntersecting) {
        if (v.dataset.src && !v.src) v.src = v.dataset.src; // 初回のみ遅延ロード
        const tryPlay = () => v.play().catch(() => {});
        tryPlay();
        v.addEventListener("canplay", tryPlay, { once: true });
      } else {
        v.pause();
      }
    });
  }, { threshold: 0.25 });
}

function startThumb(el, key) {
  const src = `${trainer().videoDir}/${key}.mp4`;
  if (state.missingVideos.has(src)) {
    startThumbFrames(el, key);
    return;
  }
  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "none";
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.dataset.src = src;
  video.onerror = () => {
    video.remove();
    state.missingVideos.add(src);
    startThumbFrames(el, key);
  };
  el.appendChild(video);
  ensureCatalogObserver();
  catalogObserver.observe(video);
}

function startThumbFrames(el, key) {
  const ex = EXERCISES[key];
  const seq = ex.seq || Array.from({ length: ex.frames }, (_, i) => i + 1);
  let i = 0;
  const draw = () => {
    setCharaImage(el, `${trainer().dir}/${key}_${seq[i]}.png`, ex.name, seq[i]);
    i = (i + 1) % seq.length;
  };
  draw();
  state.catalogTimers.push(setInterval(draw, ex.frameMs));
}

function stopCatalog() {
  state.catalogTimers.forEach(clearInterval);
  state.catalogTimers = [];
  if (catalogObserver) { catalogObserver.disconnect(); catalogObserver = null; }
  $("#catalog-list").querySelectorAll("video").forEach((v) => v.pause());
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
      `<span class="preset-icon tint-${p.tint}">${p.icon}</span>` +
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
    startBtn.onclick = () => { stopCatalog(); startWorkout(p); };
    card.appendChild(startBtn);
    list.appendChild(card);
  });
  show("screen-catalog");
}

// ---- 記録・ストリーク ----
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function streakDays() {
  const days = new Set(state.history.filter(h => h.completed).map(h => h.date));
  let streak = 0;
  const d = new Date();
  if (!days.has(todayStr(d))) d.setDate(d.getDate() - 1); // 今日未実施なら昨日起点
  while (days.has(todayStr(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

function saveResult(workout, totalWorkSec) {
  state.history.push({
    date: todayStr(), workoutId: workout.id, title: workout.title,
    totalWorkSec, completed: true, ts: Date.now(),
  });
  store.set("history", state.history);
}

// ---- Wake Lock ----
async function acquireWakeLock() {
  try {
    if ("wakeLock" in navigator) state.wakeLock = await navigator.wakeLock.request("screen");
  } catch { /* 非対応・省電力モードでは黙って諦める */ }
}
function releaseWakeLock() {
  state.wakeLock?.release().catch(() => {});
  state.wakeLock = null;
}

// ---- 進捗（忍びランク・今日/今週の集計・文脈セリフ）----
function totalExp() {
  return state.history
    .filter(h => h.completed)
    .reduce((sum, h) => sum + expForResult(h.totalWorkSec), 0);
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
function homeGreeting() {
  const completed = state.history.filter(h => h.completed);
  if (completed.length === 0) return "はじめまして。今日から一緒に、4分だけ。";
  const last = completed[completed.length - 1];
  const daysSince = Math.round(
    (new Date(todayStr() + "T00:00:00") - new Date(last.date + "T00:00:00")) / 86400000);
  if (daysSince >= 3) return `${daysSince}日ぶりだね。おかえり、また一緒にやろう。`;
  const s = streakDays();
  if (s >= 2) return `${s}日連続、その調子だよ！`;
  const hour = new Date().getHours();
  if (hour < 10) return "おはよう。朝の4分、いってみる？";
  if (hour >= 20) return "今日もお疲れさま。寝る前に少しだけ動く？";
  return quote("home");
}

function renderStatusCard() {
  const r = rankInfo(totalExp());
  const ts = todayStats();
  const wr = weekRecord();
  const pct = Math.round(r.progress * 100);
  const strip = wr.days.map(d =>
    `<div class="sc-day${d.done ? " done" : ""}${d.isToday ? " today" : ""}">` +
    `<span class="sc-dot"></span><span class="sc-dlabel">${d.label}</span></div>`).join("");
  $("#status-card").innerHTML =
    `<div class="sc-rank-row">` +
      `<span class="sc-rank">🥷 ${r.name}</span>` +
      `<span class="sc-next">${r.next ? `昇格まで あと ${r.remain}` : "最高位！"}</span>` +
    `</div>` +
    `<div class="sc-exp"><div class="sc-exp-fill" style="width:${pct}%"></div></div>` +
    `<div class="sc-stats">` +
      `<div class="sc-stat"><b>${ts.count}</b><span>今日の完走</span></div>` +
      `<div class="sc-stat"><b>${Math.round(ts.workSec / 60 * 10) / 10}</b><span>分</span></div>` +
      `<div class="sc-stat"><b>${ts.kcal}</b><span>kcal</span></div>` +
    `</div>` +
    `<div class="sc-week-head">今週の修行 <b>${wr.count}/${wr.goal}日</b></div>` +
    `<div class="sc-week">${strip}</div>`;
}

// ---- ホーム画面 ----
function renderHome() {
  stopCatalog();
  // ヒーローカードでは「迎えてくれる」joyポーズ（いいね）を表示
  showPose($("#home-chara"), "joy_2", trainer().name);
  $("#home-quote").textContent = homeGreeting();
  renderStatusCard();
  const list = $("#preset-list");
  list.innerHTML = "";
  PRESETS.forEach((p, i) => {
    const seq = p.exercises.length * p.rounds;
    const totalSec = seq * p.workSec + (seq - 1) * p.restSec + state.settings.prepareSec;
    const li = document.createElement("button");
    li.className = "preset-item";
    li.style.animationDelay = `${i * 0.05}s`;
    li.innerHTML =
      `<span class="preset-icon tint-${p.tint}">${p.icon}</span>` +
      `<span class="preset-body">` +
      `<span class="preset-title">${p.title}</span>` +
      `<span class="preset-meta">${seq}本 ・ 約${Math.ceil(totalSec / 60)}分 ・ ${p.workSec}秒/${p.restSec}秒</span>` +
      `</span>` +
      `<span class="preset-arrow">›</span>`;
    li.onclick = () => startWorkout(p);
    list.appendChild(li);
  });
  renderHistory();
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
  acquireWakeLock();
  state.currentWorkout = workout;

  let lastTickSec = null;

  const engine = new WorkoutEngine(workout, state.settings.prepareSec, {
    onSegmentChange(seg, next) {
      const label = { prepare: "準備して！", work: EXERCISES[seg.exercise].name, rest: "休憩" }[seg.type];
      $("#run-phase").textContent = label;
      $("#run-progress").textContent = `エクササイズ ${seg.slot}/${seg.total}`;
      $("#screen-run").className = `screen active phase-${seg.type}`;
      $("#run-next").textContent = next
        ? `次のエクササイズ：${EXERCISES[next.exercise].name}`
        : "次：トレーニング終了";

      // 準備・休憩中は次にやる種目のお手本を先に見せる（タバタ方式）
      playSprite($("#run-chara"), seg.exercise);

      if (seg.type === "work") {
        Sound.workStart();
        $("#run-quote").textContent = quote("work_start", { exercise: EXERCISES[seg.exercise].name });
      } else if (seg.type === "rest") {
        Sound.restStart();
        $("#run-quote").textContent = quote("rest");
      } else {
        $("#run-quote").textContent = quote("prepare", { exercise: EXERCISES[seg.exercise].name });
      }
      lastTickSec = null;
    },

    onTick(seg, remain, ratio) {
      const sec = Math.ceil(remain);
      $("#run-count").textContent = sec;
      $("#run-count").classList.toggle("urgent", seg.type === "work" && sec <= 3 && sec >= 1);
      const circle = $("#gauge-arc");
      const C = 2 * Math.PI * 45;
      circle.style.strokeDashoffset = C * ratio;

      if (sec !== lastTickSec) {
        lastTickSec = sec;
        if (sec <= 3 && sec >= 1) Sound.countTick();
        if (seg.type === "work" && sec === 5) $("#run-quote").textContent = quote("work_last5");
        if (seg.type === "work" && sec === Math.ceil(seg.sec / 2)) $("#run-quote").textContent = quote("work_mid");
      }
    },

    onFinish() {
      Sound.finish();
      stopSprite();
      $("#run-chara video")?.pause();
      releaseWakeLock();
      saveResult(workout, engine.totalWorkSec);
      renderDone(workout, engine.totalWorkSec);
    },
  });

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
    stopSprite();
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
  stopSprite();
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
  const gained = expForResult(totalWorkSec);
  const expAfter = totalExp();
  const rankBefore = rankInfo(expAfter - gained);
  const rankAfter = rankInfo(expAfter);
  const leveledUp = rankAfter.index > rankBefore.index;

  $("#done-quote").textContent = leveledUp
    ? `やった、${rankAfter.name}に昇格だね！おめでとう🎉`
    : (s >= 2 ? quote("streak", { days: s }) : quote("finish"));
  $("#done-stats").innerHTML =
    `<li>${workout.title} 完走 🎉</li>` +
    `<li>運動時間 ${Math.round(totalWorkSec / 60 * 10) / 10}分 ・ 約${estimateKcal(totalWorkSec)}kcal</li>` +
    `<li>🥷 ${rankAfter.name} ・ +${gained} 修行値</li>` +
    `<li>${s > 0 ? `🔥 ${s}日連続` : "また明日も待ってるよ"}</li>`;
  const text = encodeURIComponent(
    `${trainer().name}と一緒に「${workout.title}」完走した！🥷 #サクヤ4分HIIT #CryptoNinja`);
  $("#btn-share").href = `https://twitter.com/intent/tweet?text=${text}`;
  show("screen-done");
}

// ---- 初期化 ----
document.addEventListener("DOMContentLoaded", () => {
  $("#btn-pause").onclick = togglePause;
  $("#btn-quit").onclick = quitWorkout;
  $("#btn-done-home").onclick = renderHome;
  $("#btn-catalog").onclick = renderCatalog;
  $("#btn-catalog-back").onclick = renderHome;
  $("#btn-sound").onclick = () => {
    state.settings.sound = !state.settings.sound;
    Sound.enabled = state.settings.sound;
    store.set("settings", state.settings);
    $("#btn-sound").textContent = state.settings.sound ? "🔊" : "🔇";
  };
  $("#btn-sound").textContent = state.settings.sound ? "🔊" : "🔇";

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.engine && !state.engine.finished) acquireWakeLock();
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js");
  }
  renderHome();
});
