#!/usr/bin/env node
// 純粋ロジックのユニットテスト
// 実行: app/ で `npm test`（node --experimental-strip-types tools/test.mjs）
// 対象: data.ts の estimateKcal/expForResult/rankInfo、timer.ts の buildSegments、
//       points.ts の小判台帳、sync.ts の同期カーソル
import {
  EXERCISES, PRESETS, RANKS, WEEKLY_GOAL, DAILY_MISSIONS, MISSION_BONUS_EXP,
  estimateKcal, expForResult, rankInfo, missionForDate, weekDoneArray,
  recommendWorkout, yesterdaySummary, shouldShowHealthNotice, pauseButtonState,
  HOME_TAP_KEYS, VOICE_LINES, quoteLines, DEFAULT_SETTINGS,
  TUTORIAL_VIDEOS, TUTORIAL_READY, shouldShowTutorialPrompt, tutorialQueue,
  restBannerLabel, runNextLabel, soundIconState, fitFontSize, shareImageFileName,
} from "../src/data.ts";
import { WorkoutEngine } from "../src/timer.ts";
import {
  KOBAN_RATES, addKoban, kobanBalance, kobanLedger, _resetKobanForTest,
  pokeKobanCountToday, canEarnPokeKoban, POKE_KOBAN_DAILY_MAX,
} from "../src/points.ts";
import { pendingResults, syncCursor, setSyncCursor } from "../src/sync.ts";
import { validateNinjaName, filterHiddenRanking, hideNinja, unhideNinja, hiddenNinjas } from "../src/ranking.ts";
import { isOAuthReturnUrl } from "../src/cloud.ts";
import { streakBonusExp } from "../src/data.ts";
import { AUDIO_MIX, MP3_ENCODER_DELAY_SEC, mp3TrimSampleCount, trimChannelData,
  BGM_TRACKS, BGM_VOLUME, BGM_DUCK_VOLUME, bgmFadeSteps, shouldDuckForVoice } from "../src/audio.ts";
import { buildReminderPlan } from "../src/native.ts";
import { removeFriendFromBoard, pokeableFriends } from "../src/friends.ts";
import { readFileSync, existsSync } from "node:fs";

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`✗ ${label}\n    expected: ${e}\n    actual:   ${a}`); }
}
function ok(label, cond) { cond ? pass++ : (fail++, console.error(`✗ ${label}`)); }

// ---- estimateKcal / expForResult ----
eq("kcal: 4分タバタ(160秒work)", estimateKcal(160), Math.round(8.0 * 60 * (160 / 3600) * 1.05));
ok("kcal: 単調増加", estimateKcal(190) > estimateKcal(160));
eq("exp = 100 + kcal", expForResult(160), 100 + estimateKcal(160));

// ---- rankInfo ----
eq("rank: 0EXP = 見習い忍び", rankInfo(0).name, "見習い忍び");
eq("rank: 299EXP はまだ見習い", rankInfo(299).name, "見習い忍び");
eq("rank: 300EXP で下忍", rankInfo(300).name, "下忍");
eq("rank: 最上位で next=null", rankInfo(999999).next, null);
eq("rank: 最上位 progress=1", rankInfo(999999).progress, 1);
ok("rank: remain = 次の閾値までの残り", rankInfo(100).remain === 200);
ok("rank: RANKSは昇順", RANKS.every((r, i) => i === 0 || r.exp > RANKS[i - 1].exp));

// ---- buildSegments: 基本形 ----
const w = { workSec: 20, restSec: 10, rounds: 2, setRestSec: 0, exercises: ["a", "b"] };
const segs = WorkoutEngine.buildSegments(w, 10);
eq("segs: 先頭はprepare", segs[0], { type: "prepare", sec: 10, exercise: "a", slot: 1, total: 4 });
eq("segs: work数 = 種目×周回", segs.filter(s => s.type === "work").length, 4);
eq("segs: rest数 = work数-1", segs.filter(s => s.type === "rest").length, 3);
eq("segs: 最後はwork(restで終わらない)", segs[segs.length - 1].type, "work");
eq("segs: restは次の種目を予告", segs.find(s => s.type === "rest").exercise, "b");
{
  const totalWork = segs.filter(s => s.type === "work").reduce((x, s) => x + s.sec, 0);
  eq("segs: totalWorkSec", totalWork, 80);
}

// ---- buildSegments: 仕上げプランク ----
const segsP = WorkoutEngine.buildSegments(w, 10, 30);
eq("plank: work数が+1", segsP.filter(s => s.type === "work").length, 5);
eq("plank: 末尾はwork:plank:30(finisherフラグつき)", segsP[segsP.length - 1],
   { type: "work", sec: 30, exercise: "plank", slot: 5, total: 5, finisher: true });
ok("plank: 直前restにもfinisherフラグ", segsP[segsP.length - 2].finisher === true);
ok("plank: 通常workはfinisherではない", segsP[0].finisher === undefined && segsP[1].finisher === false);
eq("plank: 直前のrestはplankを予告", segsP[segsP.length - 2].type, "rest");
eq("plank: 直前restのexercise", segsP[segsP.length - 2].exercise, "plank");
eq("plank: total表記が全セグメントで5", new Set(segsP.map(s => s.total)).size, 1);
{
  const totalWork = segsP.filter(s => s.type === "work").reduce((x, s) => x + s.sec, 0);
  eq("plank: totalWorkSecに加算", totalWork, 110);
}
eq("plank: finisher=0なら従来どおり", JSON.stringify(WorkoutEngine.buildSegments(w, 10, 0)), JSON.stringify(segs));

// ---- buildSegments: セット間休憩 ----
const w2 = { workSec: 20, restSec: 10, rounds: 2, setRestSec: 30, exercises: ["a", "b"] };
const segs2 = WorkoutEngine.buildSegments(w2, 10);
eq("setRest: 周回境界のrestはsetRestSec", segs2.filter(s => s.type === "rest")[1].sec, 30);

// ---- PRESETS / EXERCISES 整合性 ----
ok("presets: 8本", PRESETS.length === 8);
for (const p of PRESETS) {
  ok(`preset ${p.id}: 全種目がEXERCISESに存在`, p.exercises.every(k => EXERCISES[k]));
  ok(`preset ${p.id}: 一覧カードと詳細/実行画面の表記が同じ`, p.title === p.short);
  ok(`preset ${p.id}: 必須フィールド`, !!(p.title && p.short && p.tint && p.pict && p.desc && p.workSec && p.rounds));
}
ok("plankはEXERCISESに登録済み", !!EXERCISES.plank);
ok("週目標は正の数", WEEKLY_GOAL > 0);

// ---- 今日の任務 ----
ok("mission: 同じ日は同じ任務", missionForDate("2026-07-11") === missionForDate("2026-07-11"));
ok("mission: 全任務のidが有効(any/any2/実在プリセット)", DAILY_MISSIONS.every(m =>
  m.id === "any" || m.id === "any2" || PRESETS.some(p => p.id === m.id)));
ok("mission: ボーナスは正の数", MISSION_BONUS_EXP > 0);
// 任務ラベルはPRESETSの現在のtitleと必ず一致する（メニュー改名でラベルが取り残されない）
ok("mission: ラベルは空でない", DAILY_MISSIONS.every(m => m.label && m.label.length > 0));
ok("mission: プリセット任務のラベルは現在のtitleを含む", DAILY_MISSIONS.every(m => {
  const p = PRESETS.find(x => x.id === m.id);
  return !p || m.label === `「${p.title}」を完走する`;
}));
ok("mission: 存在しないメニュー名をラベルに出さない", DAILY_MISSIONS.every(m => {
  const quoted = m.label.match(/「(.+?)」/);
  return !quoted || PRESETS.some(p => p.title === quoted[1]);
}));
{
  // 30日分でanyだけに偏らない程度に散らばる
  const ids = new Set();
  for (let d = 1; d <= 30; d++) ids.add(missionForDate(`2026-08-${String(d).padStart(2, "0")}`).id);
  ok("mission: 30日で4種類以上出る", ids.size >= 4);
}

// ---- 小判台帳（append-only） ----
_resetKobanForTest();
eq("koban: 初期残高0", kobanBalance(), 0);
addKoban(KOBAN_RATES.workout, "workout", "t1");
eq("koban: 完走+10", kobanBalance(), 10);
addKoban(KOBAN_RATES.mission, "mission", "t1");
addKoban(KOBAN_RATES.weekGoal, "week_goal", "t1");
eq("koban: 任務+週目標で計35", kobanBalance(), 35);
addKoban(-30, "unlock", "chara2");
eq("koban: 消費はマイナスdelta", kobanBalance(), 5);
eq("koban: 台帳は4エントリ（上書きされない）", kobanLedger().length, 4);
ok("koban: 全エントリにat(時刻)がある", kobanLedger().every(e => e.at > 0));
ok("koban: レートは正の数", KOBAN_RATES.workout > 0 && KOBAN_RATES.mission > 0 && KOBAN_RATES.weekGoal > 0);
ok("koban: 手裏剣レートも正の数", KOBAN_RATES.pokeSent > 0 && KOBAN_RATES.pokeReceived > 0);

// ---- 手裏剣の小判（1日3回まで・投げる側/受け取る側は独立・2026-07-23）----
{
  const mk = (source, at) => ({ delta: KOBAN_RATES.pokeSent, source, at });
  const day1a = new Date(2026, 6, 20, 9, 0).getTime();
  const day1b = new Date(2026, 6, 20, 12, 0).getTime();
  const day1c = new Date(2026, 6, 20, 21, 55).getTime();

  eq("poke-koban: 上限は3回", POKE_KOBAN_DAILY_MAX, 3);

  // (1) 1日3回の上限が効く
  const ledgerFull = [mk("poke_sent", day1a), mk("poke_sent", day1b), mk("poke_sent", day1c)];
  eq("poke-koban: 3回投げた日はカウント3", pokeKobanCountToday(ledgerFull, "poke_sent", "2026-07-20"), 3);
  ok("poke-koban: 3回で上限に達し、もう小判は得られない", !canEarnPokeKoban(ledgerFull, "poke_sent", "2026-07-20"));
  const ledgerTwo = ledgerFull.slice(0, 2);
  ok("poke-koban: 2回ならまだ小判を得られる", canEarnPokeKoban(ledgerTwo, "poke_sent", "2026-07-20"));

  // (2) 日付が変わるとリセットされる
  eq("poke-koban: 翌日はカウント0(リセット)", pokeKobanCountToday(ledgerFull, "poke_sent", "2026-07-21"), 0);
  ok("poke-koban: 前日3回投げていても翌日はまた得られる", canEarnPokeKoban(ledgerFull, "poke_sent", "2026-07-21"));

  // (3) 投げる側(poke_sent)と受け取る側(poke_received)の上限は独立
  eq("poke-koban: poke_sentが3回でもpoke_receivedは0のまま", pokeKobanCountToday(ledgerFull, "poke_received", "2026-07-20"), 0);
  ok("poke-koban: 送信が上限でも受信側はまだ得られる", canEarnPokeKoban(ledgerFull, "poke_received", "2026-07-20"));
}

// ---- 完了画面「まだの仲間へ手裏剣」の絞り込み（pokeableFriends・純粋関数・2026-07-23）----
{
  const board = [
    { friend_id: "a", ninja_name: "疾風のハヤテ", weekly_exp: 100, done_today: true },
    { friend_id: "b", ninja_name: "影のクロウ", weekly_exp: 50, done_today: false },
    { friend_id: "c", ninja_name: "霧のカゲ", weekly_exp: 40, done_today: false },
    { friend_id: "d", ninja_name: "月のシズク", weekly_exp: 30, done_today: false },
    { friend_id: "e", ninja_name: "嵐のライ", weekly_exp: 20, done_today: false },
  ];
  eq("pokeable: done_today=falseの仲間だけ残る", pokeableFriends(board).map((f) => f.friend_id), ["b", "c", "d"]);
  eq("pokeable: 最大3人まで", pokeableFriends(board).length, 3);
  eq("pokeable: 完走済みのみなら空", pokeableFriends([{ friend_id: "x", ninja_name: "x", weekly_exp: 0, done_today: true }]), []);
  eq("pokeable: null(取得失敗)は空配列で安全", pokeableFriends(null), []);
  eq("pokeable: 空配列は空配列のまま", pokeableFriends([]), []);
}

// ---- 同期カーソル ----
setSyncCursor(0);
const hist = [{ ts: 1 }, { ts: 2 }, { ts: 3 }];
eq("sync: カーソル0なら全件が未送信", pendingResults(hist).length, 3);
setSyncCursor(2);
eq("sync: カーソル2なら残り1件", pendingResults(hist).map(h => h.ts), [3]);
eq("sync: カーソルは永続化される", syncCursor(), 2);
setSyncCursor(0);

// ---- 連続日数ボーナス ----
eq("streak: 1日目はボーナスなし", streakBonusExp(1), 0);
eq("streak: 2日目+5", streakBonusExp(2), 5);
eq("streak: 7日目+30", streakBonusExp(7), 30);
eq("streak: 8日目以降も+30で頭打ち", streakBonusExp(30), 30);
eq("streak: 0日は0", streakBonusExp(0), 0);

// ---- 週間実施ドット（weekDoneArray。ウィジェットのweekDone書き出しと共通の判定基準） ----
{
  // 2026-07-20(月)始まりの週。今週=7/20(月)〜7/26(日)
  const now = new Date(2026, 6, 24); // 7/24(金)時点で見ている想定
  const history = [
    { date: "2026-07-20", completed: true },  // 月＝完走
    { date: "2026-07-21", completed: false }, // 火＝未完走(記録はあるが未完走扱い)
    { date: "2026-07-22", completed: true },  // 水＝完走
    { date: "2026-07-25", completed: true },  // 土＝完走（今週内・未来日）
    { date: "2026-07-19", completed: true },  // 先週の日＝対象外
    { date: "2026-07-27", completed: true },  // 来週の月＝対象外
  ];
  eq("weekDone: 月〜日7要素・月始まり", weekDoneArray(history, now),
     [true, false, true, false, false, true, false]);
}
{
  // 週境界: 日曜日から見た場合でも同じ週(月曜起点)を指すこと
  const sunday = new Date(2026, 6, 26); // 7/26(日)
  const history = [{ date: "2026-07-20", completed: true }]; // 同じ週の月
  eq("weekDone: 日曜日から見ても週の月曜が先頭", weekDoneArray(history, sunday),
     [true, false, false, false, false, false, false]);
}

// ---- 今日のおすすめ（recommendWorkout）----
{
  // 完走履歴なし → 先頭のメニュー
  eq("reco: 完走履歴なし(sequential)は先頭メニュー", recommendWorkout([], "sequential", PRESETS).id, PRESETS[0].id);

  // 順繰り: 直近完走の次へ（末尾以外）
  const histMid = [{ date: "2026-07-20", workoutId: PRESETS[2].id, completed: true }];
  eq("reco: 順繰りは直近完走の次のメニュー", recommendWorkout(histMid, "sequential", PRESETS).id, PRESETS[3].id);

  // 順繰りの末尾ループ: 最後のメニューの次は先頭へ戻る
  const histLast = [{ date: "2026-07-20", workoutId: PRESETS[PRESETS.length - 1].id, completed: true }];
  eq("reco: 順繰りの末尾は先頭へループ", recommendWorkout(histLast, "sequential", PRESETS).id, PRESETS[0].id);

  // 順繰り: 直近完走のworkoutIdがpresetsに存在しない(削除済みカスタム等) → 先頭にフォールバック
  const histUnknown = [{ date: "2026-07-20", workoutId: "custom_deleted_123", completed: true }];
  eq("reco: 順繰りは不明なworkoutIdなら先頭へ", recommendWorkout(histUnknown, "sequential", PRESETS).id, PRESETS[0].id);

  // ランダム(やってない優先): 今週まだやっていないメニューだけから選ばれる
  const now = new Date(2026, 6, 24); // 7/24(金)。今週=7/20(月)〜7/26(日)
  const doneIds = [PRESETS[0].id, PRESETS[1].id, PRESETS[2].id];
  const histSome = doneIds.map((id, i) => ({ date: `2026-07-2${i}`, workoutId: id, completed: true }));
  ok("reco: ランダムは今週やった分を選ばない(30回試行)", Array.from({ length: 30 }, () =>
    recommendWorkout(histSome, "random_undone", PRESETS, now).id).every((id) => !doneIds.includes(id)));

  // ランダム: 全メニュー消化済みなら全体から選ぶ(1メニューに固定されず全体から出る)
  const histAll = PRESETS.map((p, i) => ({ date: `2026-07-2${i % 7}`, workoutId: p.id, completed: true }));
  const picks = Array.from({ length: 200 }, () => recommendWorkout(histAll, "random_undone", PRESETS, now).id);
  ok("reco: 全メニュー消化済みでも常に有効なpresetsが返る", picks.every((id) => PRESETS.some((p) => p.id === id)));
  ok("reco: 全メニュー消化済みは全体プールに戻る(200回中に2種類以上出る)", new Set(picks).size >= 2);

  // 週またぎ: 先週・来週の完走は「今週まだやっていない」判定に含めない
  const histCrossWeek = [
    { date: "2026-07-13", workoutId: PRESETS[0].id, completed: true }, // 先週の月＝対象外
    { date: "2026-07-22", workoutId: PRESETS[1].id, completed: true }, // 今週の水＝対象
  ];
  const crossPicks = Array.from({ length: 60 }, () =>
    recommendWorkout(histCrossWeek, "random_undone", PRESETS, now).id);
  ok("reco: 週またぎ―今週完走分は除外され続ける", crossPicks.every((id) => id !== PRESETS[1].id));
  ok("reco: 週またぎ―先週完走分は除外されない(60回中に出る)", crossPicks.some((id) => id === PRESETS[0].id));
}

// ---- 昨日の実績（yesterdaySummary）----
{
  const now = new Date(2026, 6, 21, 0, 5); // 7/21(火) 0:05。日をまたいだ直後でも昨日=7/20扱いになること
  // 履歴が1件も無い初回を「昨日サボった」扱いにしない（2026-07-23 UT A-2）
  const noHistory = [];
  eq("yesterday: 初回（履歴ゼロ）は初対面の一言", yesterdaySummary(noHistory, now),
     { done: false, title: null, message: "はじめの1本、いっしょにやってみよう。", kind: "first" });

  // 履歴はあるが昨日は休み → 従来どおり責めない一言
  const histOld = [{ date: "2026-07-10", workoutId: "abs", completed: true }];
  eq("yesterday: 昨日休み（履歴あり）は責めないメッセージ", yesterdaySummary(histOld, now),
     { done: false, title: null, message: "昨日はお休みだったね。今日から4分、どう？", kind: "rest" });

  // 今日すでに完走していたら「今日から4分、どう？」と誘わない（2026-07-23 UT A-2）
  const histToday = [{ date: "2026-07-21", workoutId: "abs", completed: true }];
  const rt = yesterdaySummary(histToday, now);
  eq("yesterday: 今日完走済みはkind=today", rt.kind, "today");
  eq("yesterday: 今日完走済みのメッセージ", rt.message, "今日は腹筋、おつかれさま！");
  ok("yesterday: 今日完走済みで「今日から4分」と誘わない", !rt.message.includes("今日から4分"));

  // 今日と昨日の両方に記録があれば「今日」を優先する
  const histBoth = [{ date: "2026-07-20", workoutId: "legs", completed: true },
                    { date: "2026-07-21", workoutId: "abs", completed: true }];
  eq("yesterday: 今日と昨日の両方あれば今日を優先", yesterdaySummary(histBoth, now).kind, "today");

  // 未完走(completed:false)だけの履歴は初回扱い＝やっていないのに褒めない
  const histIncomplete = [{ date: "2026-07-20", workoutId: "abs", completed: false }];
  eq("yesterday: 未完走のみの履歴は初回扱い", yesterdaySummary(histIncomplete, now).kind, "first");

  const histPreset = [{ date: "2026-07-20", workoutId: "abs", title: "旧い名前", completed: true }];
  const r = yesterdaySummary(histPreset, now);
  ok("yesterday: 完走ありはdone=true", r.done === true);
  eq("yesterday: メニュー名はPRESETSのtitleを優先(記録上の古い名前でなく)", r.title, "腹筋");
  eq("yesterday: メッセージにメニュー名を含む", r.message, "昨日は腹筋、おつかれさま！");

  const histCustom = [{ date: "2026-07-20", workoutId: "custom_9999", title: "朝の目覚まし忍法", completed: true }];
  eq("yesterday: 未知のworkoutIdは記録済みtitleへフォールバック",
     yesterdaySummary(histCustom, now).title, "朝の目覚まし忍法");

  const histNoTitle = [{ date: "2026-07-20", workoutId: "custom_gone", completed: true }];
  eq("yesterday: titleも無ければ「クイック」", yesterdaySummary(histNoTitle, now).title, "クイック");

  // JST日付境界: 同日の遅い時刻でも同じ「昨日」を指す
  const lateNow = new Date(2026, 6, 21, 23, 55);
  eq("yesterday: 同日23:55でも昨日は同じ日付扱い",
     yesterdaySummary(histPreset, lateNow).done, yesterdaySummary(histPreset, now).done);
}

// ---- 忍び名バリデーション ----
eq("ninja_name: 通常名はok", validateNinjaName("疾風のハヤテ"), "ok");
eq("ninja_name: 空はempty", validateNinjaName("  "), "empty");
eq("ninja_name: 13文字はtoo_long", validateNinjaName("あ".repeat(13)), "too_long");
eq("ninja_name: 12文字はok", validateNinjaName("あ".repeat(12)), "ok");
eq("ninja_name: NGワードは弾く", validateNinjaName("うんこ忍者"), "ng_word");
eq("ninja_name: 大文字NGワードも弾く", validateNinjaName("FUCKninja"), "ng_word");

// ---- Google連携: OAuthリダイレクト復帰の検出（純粋関数） ----
ok("oauth: 通常起動(パラメータ無し)は復帰でない", !isOAuthReturnUrl("", ""));
ok("oauth: PKCEのcode=を検出", isOAuthReturnUrl("?code=abc123", ""));
ok("oauth: implicitのaccess_token=を検出(hash)", isOAuthReturnUrl("", "#access_token=xyz&type=bearer"));
ok("oauth: error=も検出(失敗復帰も同じ扱い)", isOAuthReturnUrl("?error=access_denied", ""));
ok("oauth: 無関係なクエリは検出しない", !isOAuthReturnUrl("?ref=twitter", ""));

// ---- WorkoutEngine 実行時挙動（now注入で決定的にテスト。performance.now()は使わない） ----
// テスト用の時計：makeClock().nowをWorkoutEngineに注入し、set()で任意の時刻へ一気に進める
function makeClock(startMs = 0) {
  let t = startMs;
  return { now: () => t, set: (v) => { t = v; } };
}
const wEngineTest = { workSec: 20, restSec: 10, rounds: 1, setRestSec: 0, exercises: ["a", "b"] };
// buildSegments(wEngineTest, 5) => [prepare5(a), work20(a), rest10(b), work20(b)]（既存segsテストと同型）

// 1) バックグラウンド等で一度に大きく時間が経過しても、通過したセグメントを1つ飛ばしで
//    無かったことにせず、while化した_tick()が全て消化してから正しい残り秒数を返すこと
{
  const clock = makeClock(0);
  const events = [];
  const engine = new WorkoutEngine(wEngineTest, 5, {
    onSegmentChange: (seg) => events.push({ t: "change", type: seg.type, exercise: seg.exercise }),
    onTick: (seg, remain, ratio) => events.push({ t: "tick", type: seg.type, exercise: seg.exercise, remain, ratio }),
    onFinish: () => events.push({ t: "finish" }),
  }, 0, clock.now);
  engine.start();                 // t=0でprepare(a)開始。実タイマーは使わずtickは手動で呼ぶ
  clearInterval(engine.timerId);
  // 50秒経過 = prepare5 + work20(a) + rest10 + work20(b)の15秒地点まで進んでいるはず
  clock.set(50000);
  engine._tick();
  const changes = events.filter((e) => e.t === "change").map((e) => `${e.type}:${e.exercise}`);
  eq("timer: 大ジャンプ後もprepare→workA→restB→workBを1回のtickで全て消化", changes,
     ["prepare:a", "work:a", "rest:b", "work:b"]);
  ok("timer: 最終的にindexはworkB(index3)まで進む", engine.index === 3);
  ok("timer: workBの残りは約5秒（20 - 15経過）", Math.abs(engine.current.sec - engine.segments[3].sec) < 1e-9);
  const lastTick = events.filter((e) => e.t === "tick").pop();
  ok("timer: 最後のtickイベントはworkBの残り約5秒", lastTick && Math.abs(lastTick.remain - 5) < 0.01);
  ok("timer: 最後のtickイベントの経過比率は約0.75(15/20)", lastTick && Math.abs(lastTick.ratio - 0.75) < 0.01);
}

// 2) 全セグメントの合計時間を超えるほど時間が経過した場合はonFinishまで到達すること
{
  const clock = makeClock(0);
  const events = [];
  const engine = new WorkoutEngine(wEngineTest, 5, {
    onSegmentChange: () => {},
    onTick: () => {},
    onFinish: () => events.push("finish"),
  }, 0, clock.now);
  engine.start();
  clearInterval(engine.timerId);
  // 合計 5+20+10+20=55秒。60秒経過させれば全セグメント消化してonFinishに到達するはず
  clock.set(60000);
  engine._tick();
  ok("timer: 全消化後はfinished=trueになる", engine.finished === true);
  eq("timer: onFinishが1回だけ呼ばれる", events, ["finish"]);
}

// 3) pause中は経過時間が進まない（バックグラウンド中を模した長いpause→resumeでも
//    pause直前の残り時間がそのまま維持される）ことをnow注入で決定的に検証
{
  const clock = makeClock(0);
  const ticks = [];
  const engine = new WorkoutEngine(wEngineTest, 5, {
    onSegmentChange: () => {},
    onTick: (seg, remain) => ticks.push(remain),
    onFinish: () => {},
  }, 0, clock.now);
  engine.start();
  clearInterval(engine.timerId);
  clock.set(2000);          // prepare(5秒)開始から2秒経過した地点でpause
  engine.pause();
  ok("timer: pause直後はpausedAtに現在時刻が記録される", engine.pausedAt === 2000);
  clock.set(100000);        // 98秒間バックグラウンド放置を模す（実際には何も進まないはず）
  engine.resume();
  clearInterval(engine.timerId);
  engine._tick();           // resume直後、実時間は進んでいないのでtick即時発火を模す
  ok("timer: 98秒pauseしても消費時間は2秒のまま（残り約3秒）", Math.abs(ticks[ticks.length - 1] - 3) < 0.01);
}

// 4) nowを省略した場合は既定でperformance.now()を使い、通常起動が壊れていないこと
{
  const engine = new WorkoutEngine(wEngineTest, 5, { onSegmentChange: () => {}, onTick: () => {}, onFinish: () => {} });
  engine.start();
  ok("timer: now省略時もsegStartが数値として設定される", typeof engine.segStart === "number" && engine.segStart >= 0);
  clearInterval(engine.timerId); // テストプロセスを止めないよう実タイマーは解除
}

// ---- 音声ミキシングのヘッドルーム（同時再生でのクリップ防止・実測ピークベース） ----
// 実測(ffprobe volumedetect, 2026-07-19): 声クリップ94本のピークは概ね-2.0〜-4.5dB(線形0.60〜0.79)。
// 保守的に「あり得る最大ピーク」を0.85として、以下2場面の合算が0dBFS未満に収まることを検証する。
{
  const ASSUMED_VOICE_PEAK = 0.85;
  const countdownSum = AUDIO_MIX.VOICE_GAIN * ASSUMED_VOICE_PEAK + AUDIO_MIX.SE_GAINS.countTick;
  ok("mix: カウント(ビープ+声)の合算ピークが0dBFS(線形1.0)未満", countdownSum < 1.0);
  ok("mix: カウントのヘッドルームは0.95未満に収まる", countdownSum < 0.95);
  const finishSum = AUDIO_MIX.VOICE_GAIN * ASSUMED_VOICE_PEAK + AUDIO_MIX.SE_GAINS.finish;
  ok("mix: 完走(ジングル1音目+finishボイス)の合算ピークが0dBFS未満", finishSum < 1.0);
  ok("mix: 完走のヘッドルームは0.95未満に収まる", finishSum < 0.95);
  ok("mix: SEはdestination直結でなくマスターバス経由前提のgain値のみ持つ(0未満はない)",
     Object.values(AUDIO_MIX.SE_GAINS).every((g) => g > 0 && g < 0.3));
}

// ---- mp3エンコーダのpriming無音トリム（ffprobe実測 start_time≒0.023秒を根拠に検証） ----
eq("audio: 0.023秒delay×48kHz ≒ 1104サンプル", mp3TrimSampleCount(48000), 1104);
eq("audio: サンプルレートが変わっても比例して計算される(44.1kHz)", mp3TrimSampleCount(44100), Math.round(MP3_ENCODER_DELAY_SEC * 44100));
{
  const original = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const trimmed = trimChannelData(original, 3);
  eq("audio: 先頭3サンプルが切り詰められる", Array.from(trimmed), [4, 5, 6, 7, 8, 9, 10]);
  ok("audio: nが0のときは元配列のまま", trimChannelData(original, 0) === original);
  ok("audio: nがバッファ長以上のときは元配列のまま(壊さない)", trimChannelData(original, 999) === original);
}

// ---- FIX-1 なかま解除（removeFriendFromBoard・純粋関数）----
{
  const board = [
    { friend_id: "a", ninja_name: "疾風のハヤテ", weekly_exp: 100, done_today: true },
    { friend_id: "b", ninja_name: "影のクロウ", weekly_exp: 50, done_today: false },
  ];
  eq("unfriend: 一覧から対象idが消える", removeFriendFromBoard(board, "a"),
     [{ friend_id: "b", ninja_name: "影のクロウ", weekly_exp: 50, done_today: false }]);
  eq("unfriend: 存在しないidは何も変わらない", removeFriendFromBoard(board, "zzz"), board);
  eq("unfriend: 元の配列は変更しない(非破壊)", board.length, 2);
  eq("unfriend: 空配列に対しても安全", removeFriendFromBoard([], "a"), []);
}

// ---- FIX-2 忍び名の非表示（ローカルミュート）----
{
  const rows = [
    { rank: 1, ninja_name: "疾風のハヤテ", weekly_exp: 300, is_me: false, ninja_id: "u1" },
    { rank: 2, ninja_name: "自分", weekly_exp: 200, is_me: true, ninja_id: "u2" },
    { rank: 3, ninja_name: "うざい忍者", weekly_exp: 100, is_me: false, ninja_id: "u3" },
  ];
  eq("hide: 非表示リストが空なら全件そのまま", filterHiddenRanking(rows, []), rows);
  const hidden = [{ id: "u1", name: "疾風のハヤテ", hiddenAt: 1 }];
  eq("hide: 非表示idの行が除外される", filterHiddenRanking(rows, hidden).map((r) => r.ninja_id), ["u2", "u3"]);
  const hiddenSelf = [{ id: "u2", name: "自分", hiddenAt: 1 }];
  eq("hide: 自分の行(is_me)は誤操作防止で常に残る", filterHiddenRanking(rows, hiddenSelf).map((r) => r.ninja_id),
     ["u1", "u2", "u3"]);

  // hideNinja/unhideNinja/hiddenNinjas: Node環境はlocalStorageが無いためメモリにフォールバックして動作すること
  eq("hide: 初期状態は非表示リストなし", hiddenNinjas(), []);
  hideNinja("u1", "疾風のハヤテ");
  ok("hide: 非表示に追加すると1件になる", hiddenNinjas().length === 1);
  eq("hide: 追加した内容が読み出せる(名前・id)", hiddenNinjas().map((h) => h.id), ["u1"]);
  hideNinja("u1", "疾風のハヤテ"); // 同じidを二重に隠しても増えない(冪等)
  eq("hide: 同一idの重複追加は増えない", hiddenNinjas().length, 1);
  hideNinja("u3", "うざい忍者");
  eq("hide: 2件目を追加すると2件になる", hiddenNinjas().length, 2);
  unhideNinja("u1");
  eq("hide: 解除すると1件に戻る(uzzai忍者だけ残る)", hiddenNinjas().map((h) => h.id), ["u3"]);
  unhideNinja("u3");
  eq("hide: 全解除で0件に戻る", hiddenNinjas(), []);
}

// ---- FIX-3 リマインダー「毎日」バグ修正（buildReminderPlan）----
// 修正前バグ: `at`単発予約のみで、次に再予約されるまで通知が完全に止まっていた。
// 修正後は基準時刻から daysAhead 日分をまとめて予約する（アプリを数日開かなくても途切れない）。
{
  eq("reminder: timeHHMM空はoff(予約なし)", buildReminderPlan("", false, 0), []);

  // 基準時刻: 2026-07-21(火) 07:00。リマインダー時刻20:00(まだ来ていない)・今日は未完走
  const morning = new Date(2026, 6, 21, 7, 0);
  const planMorning = buildReminderPlan("20:00", false, 0, morning, 14, 1000);
  eq("reminder: 14日分まとめて予約される(未完走・時刻前)", planMorning.length, 14);
  eq("reminder: 先頭は今日20:00(id=1000)", [planMorning[0].id, planMorning[0].at.getDate(), planMorning[0].at.getHours()],
     [1000, 21, 20]);
  eq("reminder: 2件目は翌日20:00(id=1001)", [planMorning[1].id, planMorning[1].at.getDate()], [1001, 22]);
  eq("reminder: 3週目相当のオフセットも連番で並ぶ(id=1013)", planMorning[13].id, 1013);

  // 罰しない設計：今日はもう完走済み→今日の分だけスキップ、明日以降13件は残る
  const planDoneToday = buildReminderPlan("20:00", true, 0, morning, 14, 1000);
  eq("reminder: 完走済みの今日はスキップされ13件になる", planDoneToday.length, 13);
  eq("reminder: 先頭は明日(id=1001)にずれる", planDoneToday[0].id, 1001);

  // 時刻がもう過ぎている場合は今日はそもそも予約しない(doneTodayに関わらず)
  const evening = new Date(2026, 6, 21, 21, 0); // 21時。リマインダー20:00はもう過ぎている
  const planPassed = buildReminderPlan("20:00", false, 0, evening, 14, 1000);
  eq("reminder: 時刻が過ぎていれば今日は予約せず13件になる", planPassed.length, 13);
  eq("reminder: 過ぎた場合も先頭は明日(id=1001)", planPassed[0].id, 1001);

  // daysAheadを絞った場合も件数が正しく変わること（08:00はmorning=07:00からまだ来ていないので今日分も入る）
  eq("reminder: daysAheadを3にすると最大3件", buildReminderPlan("08:00", false, 0, morning, 3, 1000).length, 3);

  // 連続日数2日以上はSTREAK_MSGS由来の文言（{n}が数字に置換されていること）を含む
  const planStreak = buildReminderPlan("20:00", false, 5, morning, 1, 1000);
  ok("reminder: streak>=2の文言に連続日数の数字が入る", planStreak[0].body.includes("5"));
  ok("reminder: 文言に{n}のプレースホルダが残らない", !planStreak[0].body.includes("{n}"));
}

// ---- FIX-4 初回起動時の健康注意モーダル（shouldShowHealthNotice）----
{
  ok("health: 未設定(undefined)は表示する", shouldShowHealthNotice(undefined));
  ok("health: false(未読)は表示する", shouldShowHealthNotice(false));
  ok("health: null(壊れた値)も表示する", shouldShowHealthNotice(null));
  ok("health: true(既読)は表示しない", !shouldShowHealthNotice(true));
}

// ---- FIX-6 一時停止ボタンのアイコン状態（pauseButtonState）----
{
  eq("pause: 実行中(paused=false)は一時停止アイコン", pauseButtonState(false), { icon: "pause", label: "一時停止" });
  eq("pause: 停止中(paused=true)は再開アイコン", pauseButtonState(true), { icon: "play", label: "再開" });
}

// ---- レスト中の重複表示の整理（2026-07-23 ルク指摘：上部バナー/中央セリフ/下部の3箇所重複を解消）----
{
  eq("restBanner: レスト中は常に「休憩」（次の種目は中央セリフが予告・2026-07-23ルク指示）",
     restBannerLabel(), "休憩");

  eq("runNext: レスト中は空文字（上部/中央と重複するため非表示）",
     runNextLabel("rest", { exercise: "burpee" }), "");
  eq("runNext: ワーク中は従来どおり種目名を表示",
     runNextLabel("work", { exercise: "burpee" }), `次のエクササイズ：${EXERCISES.burpee.name}`);
  eq("runNext: 準備中も従来どおり表示",
     runNextLabel("prepare", { exercise: "burpee" }), `次のエクササイズ：${EXERCISES.burpee.name}`);
  eq("runNext: 次がない(完走)は終了メッセージ", runNextLabel("work", null), "次：トレーニング終了");
  eq("runNext: 次がない(完走)はレスト中でも空文字", runNextLabel("rest", null), "");
}

// ---- サウンドアイコン（2026-07-23：ボイス/BGMどちらかOFFなら🔇）----
{
  eq("soundIcon: 両方ONは🔊", soundIconState(true, true), "is-on");
  eq("soundIcon: ボイスOFFは🔇", soundIconState(false, true), "is-off");
  eq("soundIcon: BGM OFFは🔇", soundIconState(true, false), "is-off");
  eq("soundIcon: 両方OFFも🔇", soundIconState(false, false), "is-off");

  // ---- シェア画像（2026-07-23 ルク指示：Xでシェアの隣に画像コピー）----
  // measureは「1文字あたり size*0.6 px」の擬似計測（実際のctx.measureText相当）
  const fakeMeasure = (t, s) => t.length * s * 0.6;
  eq("fitFont: 収まるならベースサイズのまま", fitFontSize("あいう", 1000, 46, 30, fakeMeasure), 46);
  eq("fitFont: はみ出す時は縮める", fitFontSize("あ".repeat(30), 300, 46, 30, fakeMeasure), 30);
  ok("fitFont: 縮めた結果は下限以上", fitFontSize("あ".repeat(20), 400, 46, 22, fakeMeasure) >= 22);
  ok("fitFont: 縮めた結果は幅に収まる（下限に達しない範囲で）",
     fakeMeasure("あ".repeat(10), fitFontSize("あ".repeat(10), 400, 46, 10, fakeMeasure)) <= 400);
  eq("shareFile: 記号と空白を安全な名前に置換",
     shareImageFileName("足中心 / 本気", "2026-07-23T05:00:00.000Z"), "sakuya-hiit_足中心_本気_2026-07-23.png");
  eq("shareFile: タイトルが空でも既定名で成立",
     shareImageFileName("", "2026-07-23T05:00:00.000Z"), "sakuya-hiit_workout_2026-07-23.png");
}

// ---- ホームのタップセリフ（2026-07-22 ルク判断で home_6/home_8 を廃止）----
// 連番生成に戻すと欠番を拾って無音タップになるため、キーの実在をテストで固定する
{
  ok("home: HOME_TAP_KEYSは全てVOICE_LINESに文言がある",
     HOME_TAP_KEYS.every((k) => typeof VOICE_LINES[k] === "string" && VOICE_LINES[k].length > 0));
  ok("home: 廃止したhome_6/home_8はタップ候補に入っていない",
     !HOME_TAP_KEYS.includes("home_6") && !HOME_TAP_KEYS.includes("home_8"));
  ok("home: 廃止したhome_6/home_8はVOICE_LINESからも消えている",
     VOICE_LINES.home_6 === undefined && VOICE_LINES.home_8 === undefined);
  ok("home: タップ候補は10本", HOME_TAP_KEYS.length === 10);
  {
    const audioDir = new URL("../public/assets/audio/sakuya/", import.meta.url);
    ok("home: タップ候補の音声ファイルが全て存在する",
       HOME_TAP_KEYS.every((k) => existsSync(new URL(k + ".mp3", audioDir))));
    ok("home: 廃止分の音声ファイルは削除済み",
       !existsSync(new URL("home_6.mp3", audioDir)) && !existsSync(new URL("home_8.mp3", audioDir)));
  }
}

// ---- BGM（2026-07-22 ルク指示：タイトル画面とワークアウトに音楽・設定でオンオフ）----
{
  ok("bgm: 既定はON", DEFAULT_SETTINGS.bgm === true);
  ok("bgm: トラックはタイトルとワークアウトの2本",
     Object.keys(BGM_TRACKS).join(",") === "title,workout");
  ok("bgm: 声の間は音量を下げる設定になっている", BGM_DUCK_VOLUME < BGM_VOLUME && BGM_DUCK_VOLUME > 0);
  eq("bgm: フェードは指定の音量で終わる", bgmFadeSteps(0, 0.22, 200, 40).at(-1), 0.22);
  ok("bgm: フェードは単調に増える",
     bgmFadeSteps(0, 0.22, 200, 40).every((v, i, a) => i === 0 || v > a[i - 1]));
  ok("bgm: 下げる方向も終点に到達", Math.abs(bgmFadeSteps(0.22, 0.08, 200, 40).at(-1) - 0.08) < 1e-9);
  {
    const dir = new URL("../public/", import.meta.url);
    ok("bgm: 音源ファイルが存在する", Object.values(BGM_TRACKS).every((f) => existsSync(new URL(f, dir))));
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
      ok("bgm: マイページにオンオフのトグルがある", html.includes('id="set-bgm"'));
    // カウント（さん・に・いち）でBGMを上下させない＝音楽のポンピング防止
    ok("bgm: カウント音ではダッキングしない",
       !shouldDuckForVoice("count_3") && !shouldDuckForVoice("count_1"));
    ok("bgm: 通常のセリフではダッキングする",
       shouldDuckForVoice("home_1") && shouldDuckForVoice("finish_1"));
  }
}

// ---- 「はじめまして」は初回の1回だけ（2026-07-22 ルク指示）----
{
  const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  ok("greet: greet_firstを出したら記録して二度と出さない",
     /greeted_first[\s\S]{0,120}return "greet_first"/.test(app));
  ok("greet: 未完走でも2回目以降は時間帯のあいさつになる",
     /completed\.length === 0\) \{[\s\S]{0,200}greet_morning/.test(app));
}

// ---- チュートリアル動画（初回1回だけ案内・以降マイページから）----
{
  eq("tutorial: 概要だけ", tutorialQueue("overview"), ["overview"]);
  eq("tutorial: 詳細だけ", tutorialQueue("detail"), ["detail"]);
  eq("tutorial: 両方は概要→詳細の順", tutorialQueue("both"), ["overview", "detail"]);
  eq("tutorial: 見ないは空", tutorialQueue("skip"), []);
  ok("tutorial: 未案内なら出す", shouldShowTutorialPrompt(false, true));
  ok("tutorial: 未設定(undefined)でも出す", shouldShowTutorialPrompt(undefined, true));
  ok("tutorial: 一度案内したら二度と出さない", !shouldShowTutorialPrompt(true, true));
  ok("tutorial: 動画が未配置なら出さない", !shouldShowTutorialPrompt(false, false));
  ok("tutorial: 動画は概要と詳細の2本", Object.keys(TUTORIAL_VIDEOS).join(",") === "overview,detail");
  ok("tutorial: 各動画にsrcとタイトルがある",
     Object.values(TUTORIAL_VIDEOS).every((v) => v.src && v.title));
  {
    // READYフラグと実ファイルの整合（フラグだけtrueで動画がない、を防ぐ）。
    // 動画はサーバー配信（絶対URL）に切り替えたが、配信元はローカルの public/ を build→deploy する。
    // そのため src が https の絶対URLであること＋配信元ファイルが public 配下に存在することの両方を確認する。
    const dir = new URL("../public/assets/videos/tutorial/", import.meta.url);
    const allRemote = Object.values(TUTORIAL_VIDEOS).every((v) => /^https:\/\//.test(v.src));
    const exists = Object.values(TUTORIAL_VIDEOS).every((v) => existsSync(new URL(v.src.split("/").pop(), dir)));
    ok("tutorial: READY=trueなら配信元の動画ファイルが揃っている", !TUTORIAL_READY || (allRemote && exists));
  }
  {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    ok("tutorial: 初回モーダルに4つの選択肢がある",
       ["btn-tut-overview", "btn-tut-detail", "btn-tut-both", "btn-tut-skip"].every((id) => html.includes(id)));
    ok("tutorial: 初回モーダルで「あとから見られる」ことを伝えている",
       /tutorial-modal[\s\S]{0,600}マイページでいつでも見られます/.test(html));
    ok("tutorial: マイページに常設の導線がある", html.includes("btn-tutorial-link"));
    ok("tutorial: 再生画面がある", html.includes('id="screen-tutorial"') && html.includes('id="tutorial-video"'));
  }
}

// ---- ホーム吹き出しの改行（2026-07-22 ルクのレビュー結果）----
{
  // ①ルクが位置を指定したセリフは、その通りに改行される
  eq("quote: 指定改行はそのまま行になる", quoteLines(VOICE_LINES.home_1),
     [["今日も一緒に"], ["忍ぼうね！"]]);
  eq("quote: 3行指定も維持", quoteLines(VOICE_LINES.greet_noon).length, 3);
  // ②既定は句読点の直後でだけ折り返す（かたまりに割る＝1行に収まる時は改行されない）
  eq("quote: 既定は句読点で区切る", quoteLines("休むのも修行のうち。でも今日は動く？"),
     [["休むのも修行のうち。", "でも今日は動く？"]]);
  eq("quote: home_3はルク指定の2行", quoteLines(VOICE_LINES.home_3),
     [["無理はしないで。"], ["でも、", "少しだけ前へ。"]]);
  eq("quote: 句読点がなければ1かたまり", quoteLines("ストレッチしていこう"), [["ストレッチしていこう"]]);
  // ③自然折り返しにするセリフは区切らない
  // 吹き出しの余白をなくすため、ホーム系のセリフは全て改行位置を明示している（自動折り返し任せにしない）
  ok("quote: ホーム系セリフは全て改行位置が指定済み（自動折り返しに頼らない）",
     Object.entries(VOICE_LINES)
       .filter(([k]) => k.startsWith("home_") || k.startsWith("greet_") || k === "poke_received")
       .every(([, v]) => v.includes("\n")));
  ok("quote: 空文字でも落ちない", JSON.stringify(quoteLines("")) === '[[]]');
  // 表示テキストの正本チェック（レビューで確定した文言）
  eq("quote: home_4はルク指定の文言", VOICE_LINES.home_4, "今日は、\nどのメニューにする？");
  eq("quote: greet_nightはルク指定の文言", VOICE_LINES.greet_night, "今日もお疲れ様！\n寝る前に少しだけ動く？");
  ok("quote: 改行を含むのはホーム系のセリフだけ（ワークアウト中の表示は1行のまま）",
     Object.entries(VOICE_LINES).filter(([, v]) => v.includes("\n"))
       .every(([k]) => k.startsWith("home_") || k.startsWith("greet_") || k === "poke_received"));
  ok("quote: 吹き出しの幅は中身に合わせて縮む",
     /\.hud-bubble \{[^}]*width: fit-content/.test(readFileSync(new URL("../css/style.css", import.meta.url), "utf8")));
  ok("quote: 吹き出しは左寄せ",
     /\.hud-bubble \{[^}]*text-align: left/.test(readFileSync(new URL("../css/style.css", import.meta.url), "utf8")));
}

// ---- 声とSEのネイティブ移設（マナーモードでも鳴らすため・2026-07-23 ルク決裁A）----
// 焼き出したWAVの音量はSE_GAINSと一致していなければならない（再生側は1.0固定のため、
// ここがズレると合算ヘッドルームの設計が崩れて割れる）
{
  const au = readFileSync(new URL("../src/audio.ts", import.meta.url), "utf8");
  const gen = readFileSync(new URL("./gen_se.mjs", import.meta.url), "utf8");
  const pick = (src, key) => (src.match(new RegExp(key + ":\\s*([0-9.]+)")) || [])[1];
  for (const k of ["countTick", "workStart1", "workStart2", "restStart", "finish"]) {
    ok(`SE: 焼き出しWAVのゲイン(${k})がSE_GAINSと一致`, pick(au, k) && pick(au, k) === pick(gen, k));
  }
  ok("SE: ネイティブではWAVを鳴らす", /_se\(name, webTones\)[\s\S]{0,200}?Native\.hasBgm[\s\S]{0,60}?Native\.sePlay/.test(au));
  ok("Voice: ネイティブではAVAudioPlayerへ委譲", /Native\.hasBgm[\s\S]{0,200}?Native\.voicePlay\(/.test(au));
  ok("Voice: ネイティブでは先読み(fetch+decode)をしない", /preload\(names\) \{ if \(Native\.hasBgm\) return;/.test(au));
  ok("Sound: ネイティブではAudioContextを作らない", /init\(\) \{[\s\S]{0,400}?if \(Native\.hasBgm\) return;/.test(au));
  ok("Sound: ネイティブは解錠待ちなしで鳴らせる", /unlocked\(\) \{ return Native\.hasBgm \|\|/.test(au));
}

// ---- window.confirm() の全廃（ネイティブWKWebViewで無反応になり操作不能に見えるため）----
// 2026-07-23: 中断は先にモーダル化済み。残っていた削除・番付非表示・なかま解除も askConfirm へ寄せた
{
  const ts = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  // コメント行に "window.confirm()" と書いてあるのは説明なので、数える前に落とす
  const code = ts.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
  const calls = (code.match(/(?<![A-Za-z])confirm\(/g) || []).length;
  const own = (ts.match(/askConfirm\(|closeConfirm\(/g) || []).length;
  ok("confirm: window.confirm()の呼び出しが残っていない", calls === 0);
  ok("confirm: 置き換え先のaskConfirm/closeConfirmがある", own > 0);
  ok("confirm: モーダルのDOMがある", /id="confirm-modal"[\s\S]{0,400}?id="btn-confirm-ok"[\s\S]{0,200}?id="btn-confirm-cancel"/.test(html));
  ok("confirm: 外側タップは「やめておく」扱い", /#confirm-modal"\)\.onclick[\s\S]{0,120}?closeConfirm\(false\)/.test(ts));
}

// ---- 効果音の取り消し（離脱後にビープが鳴らないこと）----
// workStart(+0.1s)とfinish(+0.15s刻み)は未来の時刻に予約するため、離脱時に取り消さないと
// 画面が消えたあとに鳴る。特にcountTickは880Hz矩形波＝警報音に聞こえる（2026-07-23 ルク報告）
{
  const ts = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  const au = readFileSync(new URL("../src/audio.ts", import.meta.url), "utf8");
  ok("SE: 予約済みオシレータを保持して止められる", /stopAll\(\) \{[\s\S]*?_live\.splice\(0\)/.test(au));
  ok("SE: visibilitychange(hidden)で取り消す", /visibilityState === "hidden"[\s\S]{0,400}?Sound\.stopAll\(\)/.test(ts));
  ok("SE: pagehideでも取り消す", /pagehide"[\s\S]{0,160}?Sound\.stopAll\(\)/.test(ts));
  ok("SE: 一時停止でも取り消す", /Voice\.stop\(\);\s*Sound\.stopAll\(\);/.test(ts));
  // 復帰時の動画は play() の成否ではなく currentTime が進んだかで判定する
  // （play()が成功してもデコーダ解放でフレームが止まったままになる・2026-07-23実機）
  ok("動画: 復帰時は再生位置が進んだかで判定する",
     /function videoProgressing[\s\S]{0,200}?video\.currentTime !== before/.test(ts));
  ok("動画: load()で戻らなければ<video>要素ごと作り直す",
     /function ensureVideoPlaying[\s\S]{0,900}?video\.load\(\)[\s\S]{0,500}?box\.innerHTML = "";\s*playSprite\(box/.test(ts));
}

// ---- ホームのjoyポーズ枠（ポーズごとの縦幅差で吹き出しが上下に飛ばないようにする）----
{
  const css = readFileSync(new URL("../css/style.css", import.meta.url), "utf8");
  ok("joy: 枠をジャンプ画像(478x960)の比率で固定している",
     /\.hud-companion \.chara-box \{[^}]*aspect-ratio: 478 \/ 960/.test(css));
  ok("joy: 画像は高さ基準（height:86%/width:auto）で揃える",
     /\.hud-companion \.chara-box img \{[^}]*height: 86%;\s*width: auto/.test(css));
  ok("joy: 基底の max-height:220px を打ち消している",
     /\.hud-companion \.chara-box img \{[^}]*max-height: 86%/.test(css));
  // 枠の86%に抑えるのは、横に広いジャンプポーズ(joy_1)の幅を他ポーズと揃えて枠内に収めるため。
  // レイヤー版(.st-chara)も同じ規則でないと、1枚絵とレイヤー版で大きさが食い違う
  ok("joy: レイヤー版も1枚絵と同じ高さ規則",
     /\.hud-companion \.chara-box \.st-chara \{[^}]*height: 86%/.test(css));
  // 回帰: flexの既定 min-width:auto だと、幅の広いjoy_1の最小内容幅に押されて左列が52%より
  // 太くなり、そのポーズの時だけ右のメニューが縮んだ（2026-07-23 ルク指摘）
  ok("joy: 左列がポーズ幅に押し広げられない（min-width:0）",
     /\.hud-companion \{[^}]*min-width: 0/.test(css));
  // どのポーズも枠からはみ出さない（旧 max-width:116% はjoy_1をあふれさせていた）
  ok("joy: ポーズは枠幅を超えない",
     /\.hud-companion \.chara-box img \{[^}]*max-width: 100%/.test(css));
}

// ---- 一時停止ボタン＝案2「静かなオーロラリング」の配線（HTML/CSS/TSの三点が噛み合っているか）----
// 見た目の切替はaria-pressed属性とCSSセレクタの一致に依存するため、静的に噛み合いを固定する
{
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../css/style.css", import.meta.url), "utf8");
  const ts = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  ok("aura: ボタンに初期aria-pressed=falseがある", /id="btn-pause"[^>]*aria-pressed="false"/.test(html));
  ok("aura: SVGに両アイコン(pause-icon/play-icon)を同梱している", ts.includes('class="pause-icon"') && ts.includes('class="play-icon"'));
  ok("aura: グラデidがSVG定義とCSS参照で一致", ts.includes('id="pauseAuraStroke"') && css.includes("url(#pauseAuraStroke)"));
  ok("aura: aria-pressed=trueで再開(三角)を見せるCSSがある", /#btn-pause\[aria-pressed="true"\] \.play-icon/.test(css));
  ok("aura: prefers-reduced-motionでリング回転を止める", /prefers-reduced-motion[\s\S]{0,200}aura-ring\s*\{\s*animation:\s*none/.test(css));
}

// ---- 中断確認をアプリ内モーダルに統一（2026-07-23：window.confirmがネイティブで効かないバグの修正）----
{
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const ts = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  ok("quit: 中断確認モーダルがHTMLにある", /id="quit-modal" class="modal-veil" hidden/.test(html));
  ok("quit: モーダルに中断ボタンとつづけるボタンがある",
     html.includes('id="btn-quit-confirm"') && html.includes('id="btn-quit-cancel"'));
  ok("quit: quitWorkoutはwindow.confirmを使わずモーダルを開くだけ",
     /function quitWorkout\(\) \{\s*\$\("#quit-modal"\)\.hidden = false;\s*\}/.test(ts));
  ok("quit: 承諾時に既存の中断処理(engine.stop/Voice.stop/releaseWakeLock/renderHome)が走る",
     /function confirmQuitWorkout\(\)[\s\S]{0,300}engine\?\.stop\(\)[\s\S]{0,200}Voice\.stop\(\)[\s\S]{0,200}releaseWakeLock\(\)[\s\S]{0,200}renderHome\(\)/.test(ts));
  ok("quit: ボタンがconfirmQuitWorkout/closeQuitModalに配線されている",
     ts.includes('$("#btn-quit-confirm").onclick = confirmQuitWorkout;') &&
     ts.includes('$("#btn-quit-cancel").onclick = closeQuitModal;'));
}

// ---- サウンドアイコンのポップオーバー：ボイス/BGM個別トグル（2026-07-23）----
{
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const ts = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  ok("soundpop: ポップオーバーがHTMLにある", html.includes('id="sound-popover"'));
  ok("soundpop: ボイス行とBGM行がある",
     /🎤 ボイス（サクヤの声）/.test(html) && /🎵 BGM/.test(html));
  ok("soundpop: 個別トグルボタンがある",
     html.includes('id="pop-toggle-voice"') && html.includes('id="pop-toggle-bgm"'));
  ok("soundpop: btn-soundはトグルポップオーバーを開閉するだけ（エンジンは止めない）",
     ts.includes("toggleSoundPopover();") && !/toggleSoundPopover[\s\S]{0,80}engine/.test(ts));
  ok("soundpop: 外側タップ（documentのclick）で閉じる仕組みがある",
     /document\.addEventListener\("click", \(\) => \{\s*const pop = \$\("#sound-popover"\);/.test(ts));
  ok("soundpop: マイページ・ポップオーバー・ヘッダーの3箇所をsyncSoundUIで揃えている",
     (ts.match(/syncSoundUI\(\)/g) || []).length >= 3);
}

// ---- クレジット（マイページ「このアプリについて」・2026-07-24）----
{
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const ts = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  ok("credits: 「このアプリについて」直下（プライバシーポリシーの次）に導線がある",
     /プライバシーポリシー・免責事項[\s\S]{0,300}?id="btn-credits-link"/.test(html));
  ok("credits: モーダルのDOMと閉じるボタンがある",
     /id="credits-modal" class="modal-veil" hidden[\s\S]{0,2000}?id="btn-credits-close"/.test(html));
  // 表示文の正本（BGM/CREDITS.md）と一致していることを確認する項目
  ok("credits: 製作者リンク（X・Substack）がある",
     html.includes('href="https://x.com/ruku_practice"') && html.includes('href="https://rukupractice.substack.com"'));
  ok("credits: キャラクター協力リンク（クリプトニンジャ公式・解説記事）がある",
     html.includes('href="https://www.ninja-dao.com/"') && html.includes('href="https://note.com/danku_mj/n/nc0f2b06daae6"'));
  ok("credits: 楽曲リンク（咲耶・フラクタル・ランナー）がBGM/CREDITS.mdの正本と一致",
     html.includes('href="https://suno.com/@ikehaya"') && html.includes('href="https://suno.com/song/3975d807-5396-48b8-8fa9-1709148353ab"'));
  ok("credits: ボイスのクレジット（Irodori-TTS・MIT License）がある",
     html.includes('href="https://github.com/Aratako/Irodori-TTS"') && html.includes("MIT License"));
  ok("credits: 外部リンクは既存パターン(target=_blank + rel=noopener)で開く。7本すべて",
     (html.match(/<a href="https:\/\/(x\.com\/ruku_practice|rukupractice\.substack\.com|www\.ninja-dao\.com\/|note\.com\/danku_mj\/n\/nc0f2b06daae6|suno\.com\/@ikehaya|suno\.com\/song\/3975d807-5396-48b8-8fa9-1709148353ab|github\.com\/Aratako\/Irodori-TTS)" target="_blank" rel="noopener">/g) || []).length === 7);
  ok("credits: 開閉の配線がある（開く・閉じる・外側タップで閉じる）",
     ts.includes('$("#btn-credits-link").onclick = () => { $("#credits-modal").hidden = false; };') &&
     ts.includes('$("#btn-credits-close").onclick = () => { $("#credits-modal").hidden = true; };') &&
     /#credits-modal"\)\.onclick[\s\S]{0,120}?\$\("#credits-modal"\)\.hidden = true;/.test(ts));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
