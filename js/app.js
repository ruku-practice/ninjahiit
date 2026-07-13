// NinjaHIIT アプリ本体：画面管理・スプライト再生・記録

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem("ninjahiit_" + key)) ?? fallback; }
    catch { return fallback; }
  },
  set(key, value) { localStorage.setItem("ninjahiit_" + key, JSON.stringify(value)); },
};

const state = {
  // 既存ユーザーの保存値に新しい設定キー（plankSec等）のデフォルトを補う
  settings: { ...DEFAULT_SETTINGS, ...store.get("settings", {}) },
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
    video.load(); // iOS WKWebView対策：src差し替え後はload()を明示
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
// サムネイルもお手本ループ動画で見せる。一覧には最大56個の種目枠があり、
// 全部に<video>要素を常設すると（一時停止中でも）iOSのハードウェアデコーダの
// 同時使用上限に達して一部が読み込めなくなる（読み込みが詰まる／画像アニメへ
// フォールバックする不具合の原因）。そのため画面内に入った時だけ<video>を生成し、
// 外れたら完全に破棄（remove）してデコーダを解放する「仮想化」方式にする。
let catalogObserver = null;
let thumbLoadSeq = 0; // 一度に複数が視界に入った時、生成をわずかにずらして同時負荷を避ける

function ensureCatalogObserver() {
  if (catalogObserver) return;
  catalogObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const el = entry.target;
      if (entry.isIntersecting) mountThumbVideo(el);
      else unmountThumbVideo(el);
    });
  }, { threshold: 0.2, rootMargin: "40px 0px" });
}

function mountThumbVideo(el) {
  if (el.querySelector("video") || el._thumbLoading) return;
  const key = el.dataset.videoKey;
  const src = `${trainer().videoDir}/${key}.mp4`;
  if (state.missingVideos.has(src)) { startThumbFrames(el, key); return; }
  el._thumbLoading = true;
  const delay = (thumbLoadSeq++ % 4) * 90; // 同時生成をずらす
  el._thumbTimer = setTimeout(() => {
    el._thumbTimer = null;
    if (!el.isConnected) return; // 遅延中に画面から消えていたら何もしない
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.onerror = () => {
      video.remove();
      state.missingVideos.add(src);
      startThumbFrames(el, key);
    };
    el.appendChild(video);
    video.src = src;
    video.load();
    const tryPlay = () => video.play().catch(() => {});
    tryPlay();
    video.addEventListener("canplay", tryPlay, { once: true });
  }, delay);
}

function unmountThumbVideo(el) {
  el._thumbLoading = false;
  if (el._thumbTimer) { clearTimeout(el._thumbTimer); el._thumbTimer = null; }
  const video = el.querySelector("video");
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load(); // ロード中断＋デコーダ解放
    video.remove();
  }
}

function startThumb(el, key) {
  const src = `${trainer().videoDir}/${key}.mp4`;
  if (state.missingVideos.has(src)) {
    startThumbFrames(el, key);
    return;
  }
  el.dataset.videoKey = key;
  ensureCatalogObserver();
  catalogObserver.observe(el);
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
  document.querySelectorAll("#catalog-list video, #detail-ex video").forEach((v) => v.pause());
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
    `<span class="detail-hero-ico"><img src="assets/ui/pict-${p.pict}.png" alt=""></span>` +
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
  const ps = state.settings.plankSec || 0;
  document.querySelectorAll("#seg-plank button").forEach((b) =>
    b.classList.toggle("on", Number(b.dataset.v) === ps));
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
    startBtn.onclick = () => openDetail(p, "catalog");
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
  const entry = {
    date: todayStr(), workoutId: workout.id, title: workout.title,
    totalWorkSec, completed: true, ts: Date.now(),
  };
  state.history.push(entry);
  // この完走で「今日の任務」を初めて達成したら、ボーナス修行値をこの記録に付与
  state.lastMissionCleared = !beforeDone && missionStatus().done;
  if (state.lastMissionCleared) entry.bonusExp = MISSION_BONUS_EXP;
  store.set("history", state.history);
  Native.backup();                                              // ネイティブ: 記録をPreferencesへ複製
  Native.syncReminder(state.settings.reminderTime, true);       // 完走した日の通知はスキップ→明日に予約し直し
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
    `<span class="hud-wd-row">${strip}</span></div>`;
  const en = $("#hud-energy");
  if (en) en.innerHTML = `⚡ <b>${wr.count}/${wr.goal}</b>`;
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
    const kcal = estimateKcal(seq * p.workSec);
    const done = presetCompletions(p.id);
    const goal = 10;
    const pct = Math.min(100, Math.round(done / goal * 100));
    const li = document.createElement("button");
    li.className = `hud-card tint-${p.tint}`;
    li.style.animationDelay = `${i * 0.05}s`;
    li.innerHTML =
      `<span class="hud-card-icon"><img src="assets/ui/pict-${p.pict}.png" alt=""></span>` +
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
  Voice.enabled = state.settings.sound;
  // この修行で使う声を先読み（定型＋登場種目の「最初は/つぎは」）
  const plankSec = state.settings.plankSec || 0;
  const exKeys = [...new Set([...workout.exercises, ...(plankSec > 0 ? ["plank"] : [])])];
  Voice.preload([
    "count_3", "count_2", "count_1", "go_1", "go_2",
    "mid_1", "mid_2", "mid_3", "last10_1", "last10_2", "finish_1", "finish_2",
    ...exKeys.map((k) => `first_${k}`), ...exKeys.map((k) => `next_${k}`),
  ]);
  acquireWakeLock();
  state.currentWorkout = workout;

  let lastTickSec = null;

  const engine = new WorkoutEngine(workout, state.settings.prepareSec, {
    onSegmentChange(seg, next) {
      // 「休憩」の単調な表示をやめ、次に何が来るかが分かるリッチな表示にする
      const restLabel = next ? `つぎは、${EXERCISES[next.exercise].name}` : "お疲れさま！";
      const label = { prepare: "準備して！", work: EXERCISES[seg.exercise].name, rest: restLabel }[seg.type];
      const icon = { prepare: "🥋", work: "🔥", rest: "💧" }[seg.type];
      $("#run-phase").innerHTML = `<span class="run-phase-ico">${icon}</span>${label}`;
      $("#run-progress").textContent = `エクササイズ ${seg.slot}/${seg.total}`;
      $("#screen-run").className = `screen hud active phase-${seg.type}`;
      $("#run-next").textContent = next
        ? `次のエクササイズ：${EXERCISES[next.exercise].name}`
        : "次：トレーニング終了";

      // 準備・休憩中は次にやる種目のお手本を先に見せる（タバタ方式）
      playSprite($("#run-chara"), seg.exercise);

      if (seg.type === "work") {
        Sound.workStart();
        Voice.playOne(["go_1", "go_2"]);                       // 「はじめっ！」（種目名は直前に予告済み）
        $("#run-quote").textContent = quote("work_start", { exercise: EXERCISES[seg.exercise].name });
      } else if (seg.type === "rest") {
        Sound.restStart();
        if (next) Voice.play(`next_${next.exercise}`);          // 休憩中に次の種目を予告「つぎは、〇〇！」
        $("#run-quote").textContent = quote("rest");
      } else {
        Voice.play(`first_${seg.exercise}`);                    // 開始「最初は、〇〇！」
        $("#run-quote").textContent = quote("prepare", { exercise: EXERCISES[seg.exercise].name });
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
        // ワーク・休憩・準備の終わる瞬間、カウントに合わせて「さん・に・いち」
        if (sec <= 3 && sec >= 1) {
          Sound.countTick();
          Voice.play(`count_${sec}`);
          Native.tick();                                        // ネイティブ: 軽い振動
        }
        if (seg.type === "work" && sec === 10 && seg.sec > 12) { // ラスト10秒（旧ラスト5秒を置換）
          Voice.playOne(["last10_1", "last10_2"]);
          $("#run-quote").textContent = "あと10秒、あとちょっと！";
        }
        // 中盤の応援。20秒ワークでは中間=10秒＝ラスト10秒と衝突するため14秒地点で言う
        const midSec = seg.sec >= 25 ? Math.ceil(seg.sec / 2) : 14;
        if (seg.type === "work" && sec === midSec && sec !== 10 && seg.sec > 15) {
          Voice.playOne(["mid_1", "mid_2", "mid_3"]);
          $("#run-quote").textContent = quote("work_mid");
        }
      }
    },

    onFinish() {
      Sound.finish();
      Voice.playOne(["finish_1", "finish_2"]);
      Native.finishBuzz();
      stopSprite();
      $("#run-chara video")?.pause();
      releaseWakeLock();
      saveResult(workout, engine.totalWorkSec);
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
    stopSprite();
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
  stopSprite();
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
  const gained = expForResult(totalWorkSec) + (missionCleared ? MISSION_BONUS_EXP : 0);
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
    (missionCleared ? `<li>🚩 今日の任務クリア！（＋${MISSION_BONUS_EXP}修行値込み）</li>` : "") +
    `<li>${s > 0 ? `🔥 ${s}日連続` : "また明日も待ってるよ"}</li>`;
  const text = encodeURIComponent(
    `${trainer().name}と一緒に「${workout.title}」完走した！🥷 #サクヤ4分HIIT #CryptoNinja`);
  $("#btn-share").href = `https://twitter.com/intent/tweet?text=${text}`;
  show("screen-done");
}

// ---- トースト（準備中の案内など） ----
let toastTimer = null;
function showToast(msg) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
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
  document.querySelectorAll("#seg-plank button").forEach((b) => {
    b.onclick = () => {
      state.settings.plankSec = Number(b.dataset.v);
      store.set("settings", state.settings);
      renderMypage();
      showToast(state.settings.plankSec > 0
        ? `仕上げプランク ${state.settings.plankSec}秒 をセット！ 🥷`
        : "仕上げプランクをオフにしたよ");
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
  $("#set-reminder").onchange = async (e) => {
    state.settings.reminderTime = e.target.value || "";
    store.set("settings", state.settings);
    const r = await Native.syncReminder(state.settings.reminderTime, todayStats().count > 0);
    if (r === "denied") showToast("通知が許可されていません。端末の設定から許可してね");
    else if (state.settings.reminderTime) showToast(`毎日 ${state.settings.reminderTime} にサクヤが誘いに来るよ 🔔`);
    else showToast("リマインダーをオフにしたよ");
  };
  document.querySelectorAll(".hud-tab[data-soon]").forEach(b => {
    b.onclick = () => showToast(`${b.dataset.soon} はただいま準備中だよ 🥷`);
  });
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
      Native.syncReminder(state.settings.reminderTime, todayStats().count > 0);
    });
  }
});
