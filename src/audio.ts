// 効果音：Web Audio APIのオシレータのみで生成（音声ファイル不要・オフライン動作）

export const Sound: any = {
  ctx: null,
  enabled: true,

  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  },

  _tone(freq, durMs, type = "sine", gain = 0.25, when = 0) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + durMs / 1000);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + durMs / 1000);
  },

  countTick() { this._tone(880, 120, "square", 0.15); },          // 残り3,2,1秒
  workStart() { this._tone(660, 90); this._tone(990, 220, "sine", 0.3, 0.1); }, // ワーク開始
  restStart() { this._tone(520, 300, "sine", 0.2); },              // 休憩開始
  finish()    { [523, 659, 784, 1047].forEach((f, i) => this._tone(f, 260, "sine", 0.25, i * 0.15)); },
};

// サクヤの声（事前生成した音声クリップを Sound のAudioContextで再生）
// iOSは開始タップで解錠済みのContextを使い回すので確実に鳴る。
export const Voice: any = {
  ctx: null,
  base: "assets/audio/sakuya/", // 既定。キャラ追加に備え、ワークアウト開始時に trainer().voiceDir で上書きされる
  buffers: {},        // name -> AudioBuffer（decode済み）
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
      .then((decoded) => { this.buffers[name] = decoded; })
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
    const buf = this.buffers[name];
    if (buf) { this._startBuf(buf, interrupt); return; }
    this._load(name).then(() => {
      if (this._want !== name) return;                       // もっと新しいセリフ要求が出た
      if (performance.now() - this._wantAt > 3000) return;   // 遅すぎる（場面が変わった）
      const b = this.buffers[name];
      if (b) this._startBuf(b, interrupt);
    });
  },

  _startBuf(buf, interrupt) {
    if (interrupt) this.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    src.onended = () => { if (this.current === src) this.current = null; };
    try { src.start(); } catch (e) { return; }
    this.current = src;
  },

  // 候補配列からランダムに1つ再生し、選んだクリップ名を返す
  // （呼び出し側が VOICE_LINES で同じセリフを画面にも表示できるように）
  playOne(names, interrupt = true) {
    if (!names || !names.length) return null;
    const name = names[Math.floor(Math.random() * names.length)];
    this.play(name, interrupt);
    return name;
  },

  stop() { if (this.current) { try { this.current.stop(); } catch (e) {} this.current = null; } },
};
