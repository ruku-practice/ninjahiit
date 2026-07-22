// NinjaHIIT データ定義：種目・プリセット・トレーナー（セリフ）

// seq: 再生するフレーム番号の並び（省略時は 1..frames のループ）
export const EXERCISES = {
  // U+200B(ゼロ幅スペース)はカード等で折り返す時に自然な位置で改行させるための目印（見た目には出ない）
  squat:            { name: "スクワット",             frames: 2, frameMs: 900 },
  squat_jump:       { name: "スクワット​ジャンプ", frames: 2, frameMs: 550 },
  side_lunge:       { name: "サイドランジ",           frames: 3, frameMs: 700, seq: [1, 2, 3, 2] },
  // 1=しゃがむ 2=ジャンプ 3=腕立て前(プランク) 4=腕立て（下）
  burpee:           { name: "バーピー",               frames: 4, frameMs: 500, seq: [1, 2, 1, 3, 4, 3] },
  mountain_climber: { name: "マウンテン​クライマー", frames: 2, frameMs: 380 },
  crunch:           { name: "クランチ",               frames: 2, frameMs: 850 },
  bicycle:          { name: "バイシクル",             frames: 2, frameMs: 480 },
  leg_raise:        { name: "ライイング​レッグレイズ", frames: 2, frameMs: 600 },
  pushup:           { name: "プッシュアップ",          frames: 2, frameMs: 850 },
  high_knees:       { name: "ハイニー",               frames: 2, frameMs: 300 },
  // ↓ 追加種目（アニメ動画は未生成。生成まで🥷プレースホルダ＋種目名で表示）
  jumping_jack:     { name: "ジャンピング​ジャック", frames: 2, frameMs: 300 },
  kickback_right:   { name: "右足​キックバック",  frames: 2, frameMs: 600 },
  kickback_left:    { name: "左足​キックバック",  frames: 2, frameMs: 600 },
  butt_bridge:      { name: "バットブリッジ",          frames: 2, frameMs: 700 },
  forward_lunge:    { name: "フォワード​ランジ",  frames: 2, frameMs: 700 },
  backward_lunge:   { name: "バックワード​ランジ", frames: 2, frameMs: 700 },
  narrow_pushup:    { name: "ナロー​プッシュアップ",    frames: 2, frameMs: 850 },
  wide_pushup:      { name: "ワイド​プッシュアップ",    frames: 2, frameMs: 850 },
  plank:            { name: "プランク",               frames: 1, frameMs: 1000 },
};

// exercises を rounds 回繰り返した並びが1回のワークアウトになる
export const PRESETS = [
  {
    id: "beginner_hiit",
    title: "足中心", short: "足中心",
    icon: "🌱", tint: "pink", pict: "stretch",
    badge: "初心者おすすめ", desc: "ゆるめ・まずはここから",
    workSec: 20, restSec: 20, rounds: 1, setRestSec: 0,
    exercises: ["forward_lunge", "side_lunge", "backward_lunge", "squat",
      "kickback_right", "kickback_left", "butt_bridge", "squat"],
  },
  {
    id: "abs",
    title: "腹筋", short: "腹筋",
    icon: "💪", tint: "purple", pict: "dumbbell",
    badge: "腹筋集中", desc: "お腹まわり集中・体幹強化",
    workSec: 20, restSec: 10, rounds: 2, setRestSec: 0,
    exercises: ["leg_raise", "crunch", "mountain_climber", "bicycle"],
  },
  {
    id: "lower",
    title: "下半身", short: "下半身",
    icon: "🦵", tint: "blue", pict: "yoga",
    badge: "脚・お尻", desc: "脚とお尻・下半身デイ",
    workSec: 20, restSec: 10, rounds: 2, setRestSec: 0,
    exercises: ["squat", "mountain_climber", "side_lunge", "jumping_jack"],
  },
  {
    id: "fat_burn",
    title: "脂肪バーニング", short: "脂肪バーニング",
    icon: "🔥", tint: "orange", pict: "dance",
    badge: "脂肪燃焼", desc: "燃やしきる・全身有酸素",
    workSec: 20, restSec: 10, rounds: 2, setRestSec: 0,
    exercises: ["burpee", "squat_jump", "squat", "mountain_climber"],
  },
  {
    id: "body_make",
    title: "引き締め", short: "引き締め",
    icon: "✨", tint: "purple", pict: "dumbbell",
    badge: "引き締め", desc: "全身を引き締める",
    workSec: 20, restSec: 10, rounds: 1, setRestSec: 0,
    exercises: ["high_knees", "jumping_jack", "kickback_right", "kickback_left",
      "pushup", "backward_lunge", "butt_bridge", "squat"],
  },
  {
    id: "serious_hiit",
    title: "本気", short: "本気",
    icon: "💥", tint: "orange", pict: "dance",
    badge: "ハード", desc: "心拍MAX・追い込む",
    workSec: 20, restSec: 10, rounds: 2, setRestSec: 0,
    exercises: ["burpee", "mountain_climber", "high_knees", "jumping_jack"],
  },
  {
    id: "super_ninja",
    title: "超忍者", short: "超忍者",
    icon: "🥷", tint: "teal", pict: "run",
    badge: "上級・全部入り", desc: "全種目チャレンジ",
    workSec: 20, restSec: 10, rounds: 1, setRestSec: 0,
    exercises: ["squat", "bicycle", "squat_jump", "mountain_climber",
      "side_lunge", "burpee", "crunch", "pushup"],
  },
  {
    id: "pushup_fest",
    title: "腕立て尽くし", short: "腕立て尽くし",
    icon: "🔺", tint: "blue", pict: "dumbbell",
    badge: "上半身集中", desc: "腕立てバリエーション制覇",
    workSec: 20, restSec: 10, rounds: 2, setRestSec: 0,
    exercises: ["pushup", "narrow_pushup", "wide_pushup", "plank"],
  },
];

export const TRAINERS = {
  sakuya: {
    name: "サクヤ",
    dir: "assets/characters/sakuya",
    videoDir: "assets/videos/sakuya",
    thumbDir: "assets/thumbs/sakuya",
    voiceDir: "assets/audio/sakuya",
    quotes: {
      home: [
        "今日も一緒に\n忍ぼうね！",
        "4分だけ、\nがんばってみない？",
        "無理はしないで。\nでも、少しだけ前へ。",
        "今日は、\nどのメニューにする？",
        "水分補給も\n忍びの心得だよ！",
        "休むのも修行のうち。\nでも今日は動く？",
        "ストレッチしてから\nいこうか！",
        "昨日のきみより、\n今日のきみ！",
        "深呼吸して。\nよし、いい顔だね！",
        "きみのペースで、\nいいんだよ！",
      ],
      prepare: [
        "次は「{exercise}」だよ。ついてきて！",
        "「{exercise}」の準備。呼吸を整えて。",
      ],
      work_start: [
        "「{exercise}」いくよ！",
        "はじめ！ わたしに合わせて！",
      ],
      work_mid: [
        "いい調子！",
        "フォームきれいだよ。",
        "呼吸を止めないでね。",
      ],
      work_last5: [
        "あとちょっと！",
        "ラスト5秒、出し切って！",
      ],
      rest: [
        "ふぅ…お水飲んでね。",
        "よく動けてるよ。次もいこう。",
      ],
      finish: [
        "お疲れさま。今日もよく忍んだね。",
        "完走、お見事。ゆっくり休んでね。",
      ],
      streak: [
        "{days}日連続…もう立派な忍びだよ。",
      ],
    },
  },
};

// 音声クリップ名 → 画面に出す文言（表示テキストと声のセリフを必ず一致させるための台本）
// 新しいクリップを追加したら必ずここにも書く。first_/next_ は種目名入りのためテンプレートで持つ
export const VOICE_LINES = {
  // ホーム（タップセリフ）
  home_1: "今日も一緒に\n忍ぼうね！",
  home_2: "4分だけ、\nがんばってみない？",
  home_3: "無理はしないで。\nでも、少しだけ前へ。",
  home_4: "今日は、\nどのメニューにする？",
  home_5: "水分補給も\n忍びの心得だよ！",
  home_7: "休むのも修行のうち。\nでも今日は動く？",
  home_9: "ストレッチしてから\nいこうか！",
  home_10: "昨日のきみより、\n今日のきみ！",
  home_11: "深呼吸して。\nよし、いい顔だね！",
  home_12: "きみのペースで、\nいいんだよ！",
  // ホーム（ログイン状況別あいさつ）
  greet_first: "はじめまして。\n今日から一緒に、\n4分だけ。",
  greet_comeback: "久しぶりだね。おかえり！\nまた一緒にやろう！",
  greet_streak: "今日も来てくれたね。\nうれしいよ。",
  greet_morning: "おはよう！\n朝の4分、いってみる？",
  greet_noon: "こんにちは！\nちょっと体を動かして、\n切り替えよう！",
  greet_night: "今日もお疲れ様！\n寝る前に少しだけ動く？",
  poke_received: "なかまから、\n手裏剣が届いてるよ。",
  // ロングワーク（30秒以上）の応援
  half_1: "はんぶん来たよ！",
  half_2: "折り返し！その調子！",
  hold10_1: "まだ10秒。呼吸を続けて。",
  finisher_plank: "仕上げは、プランク！",
  // ワークアウト中
  go_1: "いくよっ！", go_2: "はじめっ！",
  mid_1: "いい調子！", mid_2: "フォーム、きれいだよ。", mid_3: "呼吸を止めないでね。",
  last10_1: "あと10秒！", last10_2: "あとちょっと、がんばって！",
  rest_1: "ふぅ。お水飲んでね。", rest_2: "よく動けてるよ。次もいこう。",
  finish_1: "お疲れさま！ 今日もよく頑張ったね。", finish_2: "完走、お見事！ ゆっくり休んでね。",
};
// ホームのタップセリフ（実在するクリップだけを明示。home_6/home_8は2026-07-22にルク判断で廃止＝
// 連番生成だと欠番を拾って無音になるため、リストで持つ）
export const HOME_TAP_KEYS = [
  "home_1", "home_2", "home_3", "home_4", "home_5",
  "home_7", "home_9", "home_10", "home_11", "home_12",
];

export const voiceLineFirst = (exKey) => `最初は、${EXERCISES[exKey].name}！`;
export const voiceLineNext = (exKey) => `つぎは、${EXERCISES[exKey].name}！`;
export const voiceLineLast = (exKey) => `最後は、${EXERCISES[exKey].name}！`;

// plankSec: 仕上げプランク（全ワークアウト末尾に追加）0=なし / 30 / 60
// reminderTime: 毎日のリマインダー通知 "HH:MM"（空文字=オフ。通知はネイティブ版のみ）
// bgm: BGM（ホーム／ワークアウト）のオンオフ
// cheer: 応援ボイスの量 many=多め（従来） / normal=普通（あと10秒＋3-2-1のみ） / few=少なめ（3-2-1のみ）
// recommendMode: ホームの「今日のおすすめ」の選び方 sequential=順繰り（既定） / random_undone=ランダム（やってない優先）
export const DEFAULT_SETTINGS = { trainer: "sakuya", sound: true, bgm: true, prepareSec: 10, plankSec: 0, reminderTime: "", cheer: "normal", recommendMode: "sequential" };

// カロリー概算（METs 8.0 × 体重60kg 想定のざっくり値）
export function estimateKcal(totalWorkSec) {
  return Math.round((8.0 * 60 * (totalWorkSec / 3600)) * 1.05);
}

// ---- 忍びランク＆修行値（EXP）----
// 完走1回の修行値 = 100 + そのワークアウトの推定kcal（4分タバタ≈134）
export function expForResult(totalWorkSec) {
  return 100 + estimateKcal(totalWorkSec);
}

// 見習い→頭領。閾値は序盤サクサク・後半じっくり
export const RANKS = [
  { name: "見習い忍び", exp: 0 },
  { name: "下忍",       exp: 300 },
  { name: "中忍",       exp: 900 },
  { name: "上忍",       exp: 2000 },
  { name: "頭領",       exp: 4000 },
  { name: "伝説の忍び", exp: 7000 },
];

// 累計EXPから現在ランク・次ランク・進捗を求める
export function rankInfo(totalExp) {
  let i = 0;
  for (let k = 0; k < RANKS.length; k++) if (totalExp >= RANKS[k].exp) i = k;
  const cur = RANKS[i];
  const next = RANKS[i + 1] || null;
  const progress = next
    ? (totalExp - cur.exp) / (next.exp - cur.exp)
    : 1;
  return { index: i, name: cur.name, cur, next, progress, remain: next ? next.exp - totalExp : 0 };
}

// やさしい週目標（今週この回数やれたら花丸、くらいのゆるさ）
export const WEEKLY_GOAL = 3;

// 連続日数ボーナス修行値：2日目+5 … 7日目以降+30で頭打ち
// （罰しない設計：途切れてもマイナスはなく、続けた分だけ静かに増える）
export function streakBonusExp(days: number): number {
  return Math.max(0, (Math.min(days, 7) - 1) * 5);
}

// Date → "YYYY-MM-DD"。history.dateと同じ書式で比較するための単一ソース（JST想定）
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 今週（月曜始まり）7日分の実施状況。index0=月…index6=日。
// app.tsのweekRecord()（ホーム画面の週間活動ドット）と、ウィジェットへ渡すweekDoneの
// 単一ソース。「完走」の判定・週境界の取り方を両者でズレさせないためここに集約する。
export function weekDoneArray(history: { date: string; completed: boolean }[], now: Date = new Date()): boolean[] {
  const dow = (now.getDay() + 6) % 7; // 月=0 … 日=6
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow);
  const doneDates = new Set(history.filter((h) => h.completed).map((h) => h.date));
  const days: boolean[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(doneDates.has(ymd(d)));
  }
  return days;
}

// ---- 昨日の実績・今日のおすすめ（ホーム用・純粋関数）----
// 昨日(JST)に完走した記録があれば振り返りメッセージを、なければ責めない一言を返す
export function yesterdaySummary(
  history: { date: string; workoutId?: string; title?: string; completed: boolean }[],
  now: Date = new Date()
): { done: boolean; title: string | null; message: string } {
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  const hit = history.find((h) => h.completed && h.date === ymd(y));
  if (!hit) return { done: false, title: null, message: "昨日はお休みだったね。今日から4分、どう？" };
  const title = PRESETS.find((p) => p.id === hit.workoutId)?.title || hit.title || "クイック";
  return { done: true, title, message: `昨日は${title}、おつかれさま！` };
}

// 今日のおすすめメニュー（サクヤの提案として提示。数字よりサクヤ）。
// sequential（既定）: 直近に完走したメニューのpresets index の次（末尾なら先頭へループ）。
//   完走履歴が無ければ先頭のメニュー。
// random_undone: 今週(月曜始まり・JST)まだ完走していないpresetsからランダム。
//   全部やっていれば全体からランダム。
export function recommendWorkout(
  history: { date: string; workoutId?: string; completed: boolean }[],
  mode: string,
  presets: any[],
  now: Date = new Date()
): any {
  if (!presets.length) return null;
  if (mode === "random_undone") {
    const dow = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - dow);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const mondayStr = ymd(monday), sundayStr = ymd(sunday);
    const doneIds = new Set(
      history.filter((h) => h.completed && h.date >= mondayStr && h.date <= sundayStr).map((h) => h.workoutId));
    const undone = presets.filter((p) => !doneIds.has(p.id));
    const pool = undone.length ? undone : presets;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  // sequential: historyは完走のたびに末尾へ追記される前提（saveResultと同じ並び順）
  const completed = history.filter((h) => h.completed);
  if (!completed.length) return presets[0];
  const last = completed[completed.length - 1];
  const idx = presets.findIndex((p) => p.id === last.workoutId);
  if (idx === -1) return presets[0];
  return presets[(idx + 1) % presets.length];
}

// ---- 今日の任務（デイリー目標）----
// 日付文字列から決定的に選ぶ（同じ日は誰でも・何度開いても同じ任務）。クリアでボーナス修行値
export const MISSION_BONUS_EXP = 50;
export const DAILY_MISSIONS = [
  { id: "any",           label: "どれか1つ、完走する" },
  { id: "beginner_hiit", label: "「初めてのHIIT」を完走する" },
  { id: "abs",           label: "「腹筋」を完走する" },
  { id: "lower",         label: "「下半身」を完走する" },
  { id: "fat_burn",      label: "「脂肪バーニング」を完走する" },
  { id: "any",           label: "どれか1つ、完走する" },
  { id: "body_make",     label: "「ボディメイキング」を完走する" },
  { id: "serious_hiit",  label: "「本気のHIIT」を完走する" },
  { id: "super_ninja",   label: "「スーパーニンジャ」を完走する" },
  { id: "any2",          label: "2回完走する（休みながらでOK）" },
];
export function missionForDate(dateStr) {
  let h = 0;
  for (const c of dateStr) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return DAILY_MISSIONS[h % DAILY_MISSIONS.length];
}

// ---- 初回起動時の健康注意モーダル（純粋関数）----
// ack: localStorageから読んだ既読フラグ（trueのみ既読扱い）。未設定・null・不正値は「未読」＝表示する
export function shouldShowHealthNotice(ack: unknown): boolean {
  return ack !== true;
}

// ---- ホーム吹き出しの改行（2026-07-22 ルクのレビュー結果）----
// 吹き出しは左寄せ・幅は中身に合わせて縮む（CSS: width:fit-content）。
// 改行位置はセリフ側の \n で全部指定済み＝どこで折り返るかが確定するので、
// 吹き出しに無駄な余白が出ない（自動折り返し任せだと列幅いっぱいに広がってしまう）。
// 戻り値は「物理行 × その行の中のかたまり」。
export function quoteLines(text: string): string[][] {
  // 物理行（\n区切り）→ さらに句読点の直後で「かたまり」に割る。
  // かたまりはinline-blockで並べるので、万一はみ出しても語の途中では切れない。
  return String(text ?? "").split("\n")
    .map((row) => row.split(/(?<=[、。！？])/).filter((s) => s.length > 0));
}

// ---- チュートリアル動画（2026-07-22 ルク指示）----
// 初回起動時に1回だけ「見ますか？」を出し、以降は出さない。マイページからいつでも見られる。
// src は動画の置き場所。ファイルが用意できるまでは空文字にしておき、空なら初回モーダルを出さない
// （＝動画ができてからURLを入れるだけで有効になる）。
// 動画ファイルを app/public/assets/videos/tutorial/ に置いたら true にする。
// falseの間は初回モーダルもマイページの導線も出さない（未完成の動画を触らせないため）。
export const TUTORIAL_READY = true;   // 動作確認用に一時的にtrue（初稿動画を配置済み）

export const TUTORIAL_VIDEOS = {
  overview: { title: "概要", note: "約1分でざっくり", src: "assets/videos/tutorial/overview.mp4" },
  detail: { title: "詳細", note: "約2分でしっかり", src: "assets/videos/tutorial/detail.mp4" },
};

// 初回のチュートリアル案内を出すか。ack=案内済みフラグ（一度trueになったら二度と出さない）
export function shouldShowTutorialPrompt(ack: unknown, videosReady: boolean): boolean {
  return videosReady && ack !== true;
}

// 選択肢 → 再生する動画の並び（両方=概要→詳細の順に続けて再生）
export function tutorialQueue(choice: "overview" | "detail" | "both" | "skip"): string[] {
  if (choice === "overview") return ["overview"];
  if (choice === "detail") return ["detail"];
  if (choice === "both") return ["overview", "detail"];
  return [];
}

// ---- 一時停止ボタンの表示状態（純粋関数）----
// paused=trueなら「再開」アイコン（三角）を、falseなら「一時停止」アイコン（二本線）を出す
export function pauseButtonState(paused: boolean): { icon: "pause" | "play"; label: string } {
  return paused ? { icon: "play", label: "再開" } : { icon: "pause", label: "一時停止" };
}

// ---- レスト中の重複表示の整理（2026-07-23 ルク指摘対応）----
// 従来はレスト中に「上部バナー：つぎは、〇〇」「中央セリフ：つぎは、〇〇！」「下部：次のエクササイズ：〇〇」の
// 3箇所で同じ種目名が重複していた。上部バナーは「つぎは、」を削って種目名だけにし（何をやるかは一目で分かる状態を維持）、
// 下部の「次のエクササイズ：〇〇」はレスト中だけ非表示にする（ワーク中は従来どおり表示）。
export type RestNextStyle = "finisher" | "last" | "next" | null;

export function restBannerLabel(): string {
  // レスト中の上部バナーは「休憩」に固定（次の種目は中央セリフが予告する。2026-07-23ルク指示）
  return "休憩";
}

export function runNextLabel(segType: "prepare" | "work" | "rest", next: { exercise: string } | null): string {
  if (segType === "rest") return "";   // 上部バナー＋中央セリフと重複するため非表示
  if (!next) return "次：トレーニング終了";
  return `次のエクササイズ：${EXERCISES[next.exercise].name}`;
}

// ---- サウンドアイコン（2026-07-23）----
// ボイス・BGMのどちらかがOFFなら消音表示にして、状態が一目で分かるようにする
// 戻り値はSVGアイコン（#sound-icon）に付けるクラス名
export function soundIconState(voiceOn: boolean, bgmOn: boolean): "is-on" | "is-off" {
  return voiceOn && bgmOn ? "is-on" : "is-off";
}

// ---- 完了画面のシェア画像（2026-07-23）----
// Xへ貼るための1枚絵をキャンバスで描く。ここは幅に収まるフォントサイズを決める純粋関数だけを持つ
// （measure は ctx.measureText(text).width 相当を返す関数。テスト時は文字数×係数で代用する）
export function fitFontSize(
  text: string, maxWidth: number, baseSize: number, minSize: number,
  measure: (text: string, size: number) => number,
): number {
  let size = baseSize;
  while (size > minSize && measure(text, size) > maxWidth) size -= 1;
  return size;
}

// シェア画像のファイル名（保存・共有シート用）
export function shareImageFileName(title: string, isoDate: string): string {
  const safe = (title || "workout").replace(/[\\/:*?"<>|\s]+/g, "_");
  return `sakuya-hiit_${safe}_${isoDate.slice(0, 10)}.png`;
}
