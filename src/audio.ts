import { Native } from "./native.ts";

// 効果音：Web Audio APIのオシレータのみで生成（音声ファイル不要・オフライン動作）
// サクヤの声：事前生成mp3をdecodeAudioDataでバッファ化して再生。
//
// ---- 音のミキシング設計（2026-07-19）----
// SoundとVoiceは同じAudioContextを共有し、どちらも共通の「マスターバス」
// （GainNode → DynamicsCompressorNode → destination）を経由して鳴らす。
// これにより①合算ピークが0dBFSに達しても保険のリミッターが効き、②将来のBGM追加時も
// このバスに合流させるだけで済む（ctx.destination直結を増やさない）。
//
// 合算ヘッドルームの実測ベース：声クリップ(94本)のピークはffprobe volumedetectで概ね-2.0〜-4.5dB
// （線形0.60〜0.79）。保守的に「あり得る最大ピーク」を0.85として設計し、
// VOICE_GAIN・SE_GAINSは以下の2つの同時発音シーンで合算が0dBFS未満に収まるよう調整した
// （実際の数値検証は tools/test.mjs の「音声ミキシングのヘッドルーム」セクション参照）。
//   - カウント：Sound.countTick() と Voice.play(count_N) が同一tickで同時発火
//   - 完走　：Sound.finish() の1音目(t=0)と Voice.playOne(finish_N) が同時発火
const VOICE_GAIN = 0.9; // Voiceバッファの共通ゲイン（0.15→0.10としたSEとの合算ヘッドルーム確保）
const SE_GAINS = {
  countTick: 0.10,              // 0.15→0.10（カウント音声「さん・に・いち」との同時再生を想定）
  workStart1: 0.20,             // 0.25→0.20
  workStart2: 0.24,             // 0.30→0.24
  restStart: 0.16,              // 0.20→0.16
  finish: 0.16,                 // 0.25→0.16（finish_1/2ボイスの1音目との同時発火に対する余裕）
};
// テスト・検証用に公開（tools/test.mjsのヘッドルーム検証はこの値を直接使う）
export const AUDIO_MIX = { VOICE_GAIN, SE_GAINS };

// マスターバス（GainNode→DynamicsCompressorNode）。ctxごとに1つだけ作る
let masterCtx: any = null;
let masterBus: any = null;
function getMasterBus(ctx) {
  if (masterCtx === ctx && masterBus) return masterBus;
  masterCtx = ctx;
  const compressor = ctx.createDynamicsCompressor();
  // 保険のリミッター：通常運用では効かない設計だが、想定外の重なり（複数声+SE+将来のBGM等）で
  // 0dBFSを超えそうな瞬間だけハードに頭を抑える（knee=0・ratio高めでリミッター寄りに設定）
  compressor.threshold.value = -3;
  compressor.knee.value = 0;
  compressor.ratio.value = 20;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.15;
  compressor.connect(ctx.destination);
  const gain = ctx.createGain();
  gain.gain.value = 1; // マスター音量。将来ここで一括調整も可能
  gain.connect(compressor);
  masterBus = { gain, compressor };
  return masterBus;
}

// WebKitは、WebView内で鳴っているのがWeb Audioだけになるとセッションを .ambient へ張り替える。
// .ambient はマナーモード（消音スイッチ）で黙るカテゴリなので、声とSEだけが止まる
// （2026-07-23 実機：BGMをネイティブ再生へ移した結果、BGMは鳴り続け声だけ消えた。
//  <audio>を使わないかくれんぼパズルがマナーモードで黙るのと同じ現象）。
// Spotifyの中断と違い、これは取り返しがつく——カテゴリを .playback に戻せば以後の再生に効く。
// AudioContextがrunningになった時と、発話のたび（2秒に1回まで間引く）に張り直す。
// 直近に読み取ったカテゴリ（表示・切り分け用。セッションには触れない）
export const audioSessionState: any = { category: "", mix: null, other: null };
export function refreshAudioSessionState() {
  const p = Native.audioState();
  if (p && p.then) p.then((r) => {
    if (!r) return;
    audioSessionState.category = String(r.category || "").replace("AVAudioSessionCategory", "");
    audioSessionState.mix = !!r.mixWithOthers;
    audioSessionState.other = !!r.otherAudioPlaying;
  });
}

export const Sound: any = {
  ctx: null,
  enabled: true,

  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC();
    }
    this.ensureRunning();
  },

  // iOSのWebKitには標準にない "interrupted" 状態があり、他アプリが音を出し始めた時などに
  // AudioContextがそこへ落ちる。以前は "suspended" しか見ていなかったため、一度落ちると
  // 復帰を試みないまま効果音もセリフも永久に無音になっていた
  // （2026-07-23 ルク実機報告：Spotify再生中はサクヤのセリフも鳴らない）。
  // 復帰はユーザー操作や割り込み終了の後でないと成功しないので、その都度おだやかに試す。
  ensureRunning() {
    if (!this.ctx || this.ctx.state === "running") return;
    try {
      const p = this.ctx.resume();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  },

  // ユーザー操作より前かどうか（未解錠＝suspended）。解錠済みなら interrupted でも発話を試してよい
  unlocked() { return !!this.ctx && this.ctx.state !== "suspended"; },

  // 鳴らし始めた（＝これから鳴る予定の）オシレータ。stopAll()で確実に黙らせるために保持する
  _live: [],

  _tone(freq, durMs, type = "sine", gain = 0.25, when = 0) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + durMs / 1000);
    osc.connect(g).connect(getMasterBus(this.ctx).gain); // destination直結ではなくマスターバス経由
    osc.start(t0);
    osc.stop(t0 + durMs / 1000);
    this._live.push(osc);
    osc.onended = () => { const i = this._live.indexOf(osc); if (i >= 0) this._live.splice(i, 1); };
  },

  // 予約済みの効果音も含めて全部止める。
  // これが無かったため、アプリを離れる直前に鳴った/予約された音が画面が消えたあとに鳴っていた
  // （2026-07-23 ルク報告「閉じようとした時に警戒的なビープ音」＝880Hz矩形波のcountTick）。
  // workStart(+0.1s)とfinish(+0.15s刻み)は未来の時刻に予約するので、離脱時に取り消す必要がある。
  stopAll() {
    for (const osc of this._live.splice(0)) { try { osc.stop(); } catch (e) {} }
  },

  countTick() { this._tone(880, 120, "square", SE_GAINS.countTick); },          // 残り3,2,1秒
  workStart() { this._tone(660, 90, "sine", SE_GAINS.workStart1); this._tone(990, 220, "sine", SE_GAINS.workStart2, 0.1); }, // ワーク開始
  restStart() { this._tone(520, 300, "sine", SE_GAINS.restStart); },              // 休憩開始
  finish()    { [523, 659, 784, 1047].forEach((f, i) => this._tone(f, 260, "sine", SE_GAINS.finish, i * 0.15)); },
};

// mp3エンコーダのpriming無音（実測: ffprobe start_time≒0.023秒、48kHzで約1104サンプル）を
// デコード後バッファの先頭から取り除くための定数・関数。
// AudioContext非依存の純粋な部分（サンプル数計算・チャンネル配列の切り詰め）を分離してテスト可能にしてある。
export const MP3_ENCODER_DELAY_SEC = 0.023;

// サンプルレートから切り詰めサンプル数を計算する（純粋関数・AudioContext不要）
export function mp3TrimSampleCount(sampleRate: number, delaySec = MP3_ENCODER_DELAY_SEC): number {
  return Math.max(0, Math.round(delaySec * sampleRate));
}

// チャンネルデータ(Float32Array)の先頭n samplesを切り詰めた配列を返す（純粋関数・AudioContext不要）
export function trimChannelData(channelData: Float32Array, n: number): Float32Array {
  return n > 0 && n < channelData.length ? channelData.subarray(n) : channelData;
}

// decodeAudioData直後のAudioBufferから、先頭のエンコーダpriming無音を除いた新しいバッファを作る
// (ctx.createBuffer / copyToChannel を使うためブラウザ実行時のみ有効)
export function trimLeadingSilence(ctx, buffer) {
  const n = mp3TrimSampleCount(buffer.sampleRate);
  if (n <= 0 || n >= buffer.length) return buffer;
  const trimmed = ctx.createBuffer(buffer.numberOfChannels, buffer.length - n, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    trimmed.copyToChannel(trimChannelData(buffer.getChannelData(ch), n), ch);
  }
  return trimmed;
}

// サクヤの声（事前生成した音声クリップを Sound のAudioContextで再生）
// iOSは開始タップで解錠済みのContextを使い回すので確実に鳴る。
export const Voice: any = {
  ctx: null,
  base: "assets/audio/sakuya/", // 既定。キャラ追加に備え、ワークアウト開始時に trainer().voiceDir で上書きされる
  buffers: {},        // name -> AudioBuffer（decode済み・先頭無音トリム済み）
  pending: {},        // name -> Promise（多重fetch防止）
  missing: {},        // name -> true（無い/失敗）
  current: null,      // 再生中のsource
  enabled: true,

  useCtx(ctx) { this.ctx = ctx; },

  // キャラ（トレーナー）ごとの音声フォルダを設定。切り替え時は旧キャラのキャッシュを破棄
  setBase(dir) {
    const b = dir.endsWith("/") ? dir : dir + "/";
    if (b !== this.base) { this.base = b; this.buffers = {}; this.missing = {}; this.pending = {}; }
  },

  _load(name) {
    if (this.buffers[name] || this.missing[name] || !this.ctx) return this.pending[name] || Promise.resolve();
    if (this.pending[name]) return this.pending[name];
    this.pending[name] = fetch(this.base + name + ".mp3")
      // Capacitor(capacitor://)のローカルリソースはfetchがstatus=0/ok=falseを返すことがあるが
      // 中身は正常に読めるため、r.okでは判定しない。破損データならdecodeAudioDataが自然に失敗する
      .then((r) => r.arrayBuffer())
      .then((buf) => new Promise((res, rej) => this.ctx.decodeAudioData(buf, res, rej)))
      .then((decoded) => { this.buffers[name] = trimLeadingSilence(this.ctx, decoded); })
      .catch(() => { this.missing[name] = true; })
      .finally(() => { delete this.pending[name]; });
    return this.pending[name];
  },

  // 使う分をまとめて先読み（キャッシュから即返る）
  preload(names) { if (this.ctx) names.forEach((n) => this._load(n)); },

  // name を再生。未ロードならロード完了後に再生する（ただし3秒以内かつ最新の要求のみ。
  // 古い要求が後から鳴る事故を防ぐ）。interrupt=trueで前の声を止める
  play(name, interrupt = true) {
    if (!this.enabled || !this.ctx || !name) return;
    this._want = name;
    this._wantAt = performance.now();
    // interruptedのまま鳴らしても無音になるだけなので、復帰を待ってから発話する。
    // 下の鮮度チェック（3秒／最新要求のみ）が効くので、復帰が遅れて場面が変わった場合は
    // 自動的に見送られる。
    if (this.ctx.state !== "running") {
      let p = null;
      try { p = this.ctx.resume(); } catch (e) {}
      if (p && p.then) { p.then(() => this._dispatch(name, interrupt)).catch(() => {}); return; }
    }
    this._dispatch(name, interrupt);
  },

  _dispatch(name, interrupt) {
    if (this._want !== name) return;                         // もっと新しいセリフ要求が出た
    if (performance.now() - this._wantAt > 3000) return;     // 遅すぎる（場面が変わった）
    const duckable = shouldDuckForVoice(name);
    const buf = this.buffers[name];
    if (buf) { this._startBuf(buf, interrupt, duckable); return; }
    this._load(name).then(() => {
      if (this._want !== name) return;                       // もっと新しいセリフ要求が出た
      if (performance.now() - this._wantAt > 3000) return;   // 遅すぎる（場面が変わった）
      const b = this.buffers[name];
      if (b) this._startBuf(b, interrupt, duckable);
    });
  },

  _startBuf(buf, interrupt, duckable = true) {
    if (interrupt) this.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = VOICE_GAIN; // SEとの合算ヘッドルーム確保のため0.9倍
    src.connect(g).connect(getMasterBus(this.ctx).gain); // destination直結ではなくマスターバス経由
    src.onended = () => {
      if (this.current === src) { this.current = null; if (duckable) Bgm.duck(false); }
    };
    try { src.start(); } catch (e) { return; }
    this.current = src;
    if (duckable) Bgm.duck(true, buf.duration);   // 声の間はBGMを下げる（カウント音は除く）
  },

  // 候補配列からランダムに1つ再生し、選んだクリップ名を返す
  // （呼び出し側が VOICE_LINES で同じセリフを画面にも表示できるように）
  playOne(names, interrupt = true) {
    if (!names || !names.length) return null;
    const name = names[Math.floor(Math.random() * names.length)];
    this.play(name, interrupt);
    return name;
  },

  stop() { if (this.current) { try { this.current.stop(); } catch (e) {} this.current = null; } Bgm.duck(false); },
};

// ---- BGM（2026-07-22 ルク指示：タイトル画面とワークアウトに音楽を敷く）----
// 12分の長尺をWebAudioでdecodeするとメモリを大量に食う（float32で百MB級）ため、
// BGMだけは <audio loop> のストリーミング再生にする。声が鳴っている間は音量を下げる（ダッキング）。
export const BGM_TRACKS = { title: "assets/bgm/title.mp3", workout: "assets/bgm/workout.mp3" };
export const BGM_VOLUME = 0.22;        // 通常の音量
export const BGM_DUCK_VOLUME = 0.08;   // サクヤが喋っている間（聞き取りを最優先）
const BGM_FADE_MS = 600;
const BGM_DUCK_HOLD_MS = 450;          // 声が終わってもすぐ戻さない（連続するセリフでの音量の上下動を防ぐ）

// この声ではBGMを下げない。「さん・に・いち」は0.3秒×3連発で、都度ダッキングすると
// 音楽がポンピングして気持ち悪くなる（2026-07-22 ルク指摘のカウント違和感の原因）
export function shouldDuckForVoice(name: string): boolean {
  return !/^count_/.test(String(name || ""));
}

// 音量を滑らかに変える（曲の切り替わり・ダッキングのプツッを防ぐ）
export function bgmFadeSteps(from: number, to: number, ms = BGM_FADE_MS, stepMs = 40): number[] {
  const n = Math.max(1, Math.round(ms / stepMs));
  return Array.from({ length: n }, (_, i) => from + (to - from) * ((i + 1) / n));
}

export const Bgm: any = {
  enabled: true,          // 設定のBGMトグル
  el: null,               // HTMLAudioElement
  track: null,            // 再生中のトラック名（"title" | "workout"）
  ducked: false,
  _timer: null,

  _audio() {
    if (!this.el) {
      const el = new Audio();
      el.loop = true;
      el.preload = "none";
      el.volume = 0;
      this.el = el;
    }
    return this.el;
  },

  _fadeTo(target, ms = BGM_FADE_MS) {
    const el = this._audio();
    clearInterval(this._timer);
    const steps = bgmFadeSteps(el.volume, target, ms);
    let i = 0;
    this._timer = setInterval(() => {
      el.volume = Math.min(1, Math.max(0, steps[i++]));
      if (i >= steps.length) clearInterval(this._timer);
    }, 40);
  },

  // ネイティブ(iOS)ではAVAudioPlayerへ委譲する。理由＝WKWebViewの<audio>はWebKitが
  // 「このアプリの音楽再生」としてOSに登録してしまい、⑴非mixingセッションがactivateされた
  // 瞬間にSpotify等が"中断"され（あとからカテゴリを張り直しても他アプリの再生は戻せない）
  // ⑵バックグラウンドでNow Playingに出る ⑶マナーモードの扱いが声と食い違う、の3つが起きる。
  // どれもWeb側から抑止する手段がない（2026-07-23 ルク実機報告・かくれんぼパズルとの比較で確認）。
  get _useNative() { return Native.hasBgm; },

  // 指定トラックを再生（同じ曲なら鳴らし直さない）。ユーザー操作より前だと再生が拒否されるが、
  // その場合は例外を握りつぶす（次のタップで鳴る）
  play(track) {
    if (!this.enabled || !BGM_TRACKS[track]) return;
    if (this._useNative) {
      this.track = track;
      Native.bgmPlay(track, this.ducked ? BGM_DUCK_VOLUME : BGM_VOLUME);
      return;
    }
    const el = this._audio();
    if (this.track === track && !el.paused) return;
    if (this.track !== track) {
      el.src = BGM_TRACKS[track];
      el.currentTime = 0;
      this.track = track;
    }
    el.volume = 0;
    el.play().then(() => this._fadeTo(this.ducked ? BGM_DUCK_VOLUME : BGM_VOLUME)).catch(() => {});
  },

  stop() {
    clearInterval(this._timer);
    this.track = null;
    if (this._useNative) { Native.bgmStop(); return; }
    if (!this.el) return;
    this.el.pause();
    this.el.volume = 0;
  },

  pause() {
    if (this._useNative) { Native.bgmPause(); return; }
    if (this.el) this.el.pause();
  },
  resume() {
    if (!this.enabled || !this.track) return;
    if (this._useNative) { Native.bgmResume(); return; }
    if (this.el) this.el.play().catch(() => {});
  },

  // サクヤの声の間だけ音量を下げる。戻すのはホールド時間ぶん待ってから＝
  // セリフが連続しても音量が上下にバタつかない
  _unduckTimer: null,
  // maxSec: その声の長さ。onendedが来ない場合（再生できなかった等）でも必ず戻すための保険。
  // これがないと、起動直後の自動あいさつが鳴らなかった端末でBGMが下がりっぱなしになる
  duck(on, maxSec = 0) {
    clearTimeout(this._unduckTimer);
    if (on) {
      this.ducked = true;
      this._setVolume(BGM_DUCK_VOLUME, 200);
      this._unduckTimer = setTimeout(() => this.duck(false), (maxSec > 0 ? maxSec * 1000 : 6000) + BGM_DUCK_HOLD_MS);
      return;
    }
    this._unduckTimer = setTimeout(() => {
      this.ducked = false;
      this._setVolume(BGM_VOLUME, 500);
    }, BGM_DUCK_HOLD_MS);
  },

  // ネイティブはAVAudioPlayerのfadeDurationで、Webは従来のsetIntervalフェードで音量を変える
  _setVolume(target, ms) {
    if (this._useNative) { if (this.track) Native.bgmVolume(target, ms); return; }
    if (this.el && !this.el.paused) this._fadeTo(target, ms);
  },

  setEnabled(on) {
    this.enabled = !!on;
    if (!on) this.stop();
  },
};
