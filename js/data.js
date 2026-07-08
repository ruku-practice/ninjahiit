// NinjaHIIT データ定義：種目・プリセット・トレーナー（セリフ）

// seq: 再生するフレーム番号の並び（省略時は 1..frames のループ）
const EXERCISES = {
  squat:            { name: "スクワット",             frames: 2, frameMs: 900 },
  squat_jump:       { name: "スクワットジャンプ",      frames: 2, frameMs: 550 },
  side_lunge:       { name: "サイドランジ",           frames: 3, frameMs: 700, seq: [1, 2, 3, 2] },
  // 1=しゃがむ 2=ジャンプ 3=腕立て前(プランク) 4=腕立て（下）
  burpee:           { name: "バーピー",               frames: 4, frameMs: 500, seq: [1, 2, 1, 3, 4, 3] },
  mountain_climber: { name: "マウンテンクライマー",    frames: 2, frameMs: 380 },
  crunch:           { name: "クランチ",               frames: 2, frameMs: 850 },
  bicycle:          { name: "バイシクル",             frames: 2, frameMs: 480 },
  leg_raise:        { name: "ライイングレッグレイズ",  frames: 2, frameMs: 600 },
  pushup:           { name: "プッシュアップ",          frames: 2, frameMs: 850 },
  high_knees:       { name: "ハイニー",               frames: 2, frameMs: 300 },
};

// exercises を rounds 回繰り返した並びが1回のワークアウトになる
const PRESETS = [
  {
    id: "tabata_full",
    title: "全身タバタ（4分）", short: "全身タバタ",
    icon: "🔥", tint: "orange", pict: "dance",
    badge: "人気No.1", desc: "全身をまんべんなく・脂肪燃焼",
    workSec: 20, restSec: 10, rounds: 2, setRestSec: 0,
    exercises: ["burpee", "squat", "mountain_climber", "squat_jump"],
  },
  {
    id: "abs",
    title: "腹筋ワークアウト", short: "腹筋",
    icon: "💪", tint: "purple", pict: "dumbbell",
    badge: "腹筋集中", desc: "お腹まわり集中・体幹強化",
    workSec: 20, restSec: 10, rounds: 2, setRestSec: 0,
    exercises: ["leg_raise", "crunch", "mountain_climber", "bicycle"],
  },
  {
    id: "lower",
    title: "下半身", short: "下半身",
    icon: "🦵", tint: "blue", pict: "yoga",
    badge: "下半身", desc: "脚とお尻・下半身デイ",
    workSec: 20, restSec: 10, rounds: 2, setRestSec: 0,
    exercises: ["squat", "side_lunge", "squat_jump", "squat"],
  },
  {
    id: "beginner",
    title: "はじめての忍びHIIT（ゆるめ）", short: "はじめて",
    icon: "🌱", tint: "pink", pict: "stretch",
    badge: "初心者おすすめ", desc: "ゆるめ・まずはここから",
    workSec: 20, restSec: 20, rounds: 2, setRestSec: 0,
    exercises: ["squat", "crunch", "side_lunge", "pushup"],
  },
  {
    id: "cardio_boost",
    title: "有酸素ブースト", short: "有酸素",
    icon: "⚡", tint: "teal", pict: "run",
    badge: "脂肪燃焼ゾーン", desc: "心拍を上げる・有酸素",
    workSec: 20, restSec: 10, rounds: 2, setRestSec: 0,
    exercises: ["high_knees", "burpee", "mountain_climber", "squat_jump"],
  },
];

const TRAINERS = {
  sakuya: {
    name: "サクヤ",
    dir: "assets/characters/sakuya",
    videoDir: "assets/videos/sakuya",
    quotes: {
      home: [
        "今日も一緒に忍ぼうね。",
        "4分だけ、がんばってみない？",
        "無理はしないで。でも、少しだけ前へ。",
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

const DEFAULT_SETTINGS = { trainer: "sakuya", sound: true, prepareSec: 10 };

// カロリー概算（METs 8.0 × 体重60kg 想定のざっくり値）
function estimateKcal(totalWorkSec) {
  return Math.round((8.0 * 60 * (totalWorkSec / 3600)) * 1.05);
}

// ---- 忍びランク＆修行値（EXP）----
// 完走1回の修行値 = 100 + そのワークアウトの推定kcal（4分タバタ≈134）
function expForResult(totalWorkSec) {
  return 100 + estimateKcal(totalWorkSec);
}

// 見習い→頭領。閾値は序盤サクサク・後半じっくり
const RANKS = [
  { name: "見習い忍び", exp: 0 },
  { name: "下忍",       exp: 300 },
  { name: "中忍",       exp: 900 },
  { name: "上忍",       exp: 2000 },
  { name: "頭領",       exp: 4000 },
  { name: "伝説の忍び", exp: 7000 },
];

// 累計EXPから現在ランク・次ランク・進捗を求める
function rankInfo(totalExp) {
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
const WEEKLY_GOAL = 3;
