// 効果音：Web Audio APIのオシレータのみで生成（音声ファイル不要・オフライン動作）

const Sound = {
  ctx: null,
  enabled: true,

  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
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
