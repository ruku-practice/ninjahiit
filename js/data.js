// NinjaHIIT データ定義：種目・プリセット・トレーナー（セリフ）

// seq: 再生するフレーム番号の並び（省略時は 1..frames のループ）
const EXERCISES = {
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
  narrow_pushup:    { name: "ナロープッシュアップ",    frames: 2, frameMs: 850 },
  wide_pushup:      { name: "ワイドプッシュアップ",    frames: 2, frameMs: 850 },
  plank:            { name: "プランク",               frames: 1, frameMs: 1000 },
};

// exercises を rounds 回繰り返した並びが1回のワークアウトになる
const PRESETS = [
  {
    id: "beginner_hiit",
    title: "初めてのHIIT", short: "はじめて",
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
    title: "脂肪バーニング", short: "脂肪バーン",
    icon: "🔥", tint: "orange", pict: "dance",
    badge: "脂肪燃焼", desc: "燃やしきる・全身有酸素",
    workSec: 20, restSec: 10, rounds: 2, setRestSec: 0,
    exercises: ["burpee", "squat_jump", "squat", "mountain_climber"],
  },
  {
    id: "body_make",
    title: "ボディメイキング", short: "引き締め",
    icon: "✨", tint: "purple", pict: "dumbbell",
    badge: "引き締め", desc: "全身を引き締める",
    workSec: 20, restSec: 10, rounds: 1, setRestSec: 0,
    exercises: ["high_knees", "jumping_jack", "kickback_right", "kickback_left",
      "pushup", "backward_lunge", "butt_bridge", "squat"],
  },
  {
    id: "serious_hiit",
    title: "本気のHIIT", short: "本気",
    icon: "💥", tint: "orange", pict: "dance",
    badge: "ハード", desc: "心拍MAX・追い込む",
    workSec: 20, restSec: 10, rounds: 2, setRestSec: 0,
    exercises: ["burpee", "mountain_climber", "high_knees", "jumping_jack"],
  },
  {
    id: "super_ninja",
    title: "スーパーニンジャ", short: "超忍者",
    icon: "🥷", tint: "teal", pict: "run",
    badge: "上級・全部入り", desc: "全種目チャレンジ",
    workSec: 20, restSec: 10, rounds: 1, setRestSec: 0,
    exercises: ["squat", "bicycle", "squat_jump", "mountain_climber",
      "side_lunge", "burpee", "crunch", "pushup"],
  },
  {
    id: "pushup_fest",
    title: "プッシュアップ尽くし", short: "腕立て尽くし",
    icon: "🔺", tint: "blue", pict: "dumbbell",
    badge: "上半身集中", desc: "腕立てバリエーション制覇",
    workSec: 20, restSec: 10, rounds: 2, setRestSec: 0,
    exercises: ["pushup", "narrow_pushup", "wide_pushup", "plank"],
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

// plankSec: 仕上げプランク（全ワークアウト末尾に追加）0=なし / 30 / 60
// reminderTime: 毎日のリマインダー通知 "HH:MM"（空文字=オフ。通知はネイティブ版のみ）
const DEFAULT_SETTINGS = { trainer: "sakuya", sound: true, prepareSec: 10, plankSec: 0, reminderTime: "" };

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

// ---- 今日の任務（デイリー目標）----
// 日付文字列から決定的に選ぶ（同じ日は誰でも・何度開いても同じ任務）。クリアでボーナス修行値
const MISSION_BONUS_EXP = 50;
const DAILY_MISSIONS = [
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
function missionForDate(dateStr) {
  let h = 0;
  for (const c of dateStr) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return DAILY_MISSIONS[h % DAILY_MISSIONS.length];
}
