// 効果音4種を、app/src/audio.ts のオシレータ定義とまったく同じ波形・同じ音量エンベロープで
// WAVに焼き出す。マナーモードでもSEを鳴らすためネイティブ(AVAudioPlayer)へ移す必要があり、
// Web Audioのオシレータをそのまま持っていけないため（2026-07-23 ルク決裁「A：声とSEもネイティブへ」）。
//
// 音色を変えないための約束：
//  - 音量エンベロープは setValueAtTime(g,t0) → exponentialRampToValueAtTime(0.001, t0+dur) と同じ
//    指数減衰： g(t) = g0 * (0.001/g0)^((t-t0)/dur)
//  - square は素の矩形波ではなく、Web Audioと同じく帯域制限（ナイキストまでの奇数倍音の加算）
//  - SE_GAINS の値をファイルに焼き込む＝再生側の音量は1.0でよい（合算ヘッドルームの設計を維持）
//
// 実行： node tools/gen_se.mjs   → app/public/assets/audio/se/*.wav
import { writeFileSync, mkdirSync } from "node:fs";

const SR = 44100;
// app/src/audio.ts の SE_GAINS と同値。変更したらここも合わせること（テストで一致を検査している）
const SE_GAINS = { countTick: 0.10, workStart1: 0.20, workStart2: 0.24, restStart: 0.16, finish: 0.16 };

// 1音＝{freq, durMs, type, gain, when}。audio.ts の _tone() の引数と同じ並び
const SE = {
  count_tick:  [{ freq: 880, durMs: 120, type: "square", gain: SE_GAINS.countTick, when: 0 }],
  work_start:  [{ freq: 660, durMs: 90,  type: "sine", gain: SE_GAINS.workStart1, when: 0 },
                { freq: 990, durMs: 220, type: "sine", gain: SE_GAINS.workStart2, when: 0.1 }],
  rest_start:  [{ freq: 520, durMs: 300, type: "sine", gain: SE_GAINS.restStart, when: 0 }],
  finish:      [523, 659, 784, 1047].map((freq, i) => (
                { freq, durMs: 260, type: "sine", gain: SE_GAINS.finish, when: i * 0.15 })),
};

// 帯域制限した波形の1サンプル（位相phase[rad]）。Web AudioのOscillatorNodeに合わせる
function sample(type, phase, freq) {
  if (type === "sine") return Math.sin(phase);
  // square: 奇数倍音のみを 4/(πn) の重みで、ナイキスト未満まで加算
  let v = 0;
  for (let n = 1; n * freq < SR / 2; n += 2) v += Math.sin(n * phase) / n;
  return (4 / Math.PI) * v;
}

// exponentialRampToValueAtTime(0.001, t0+dur) と同じ指数減衰
function envelope(g0, t, durSec) {
  return g0 * Math.pow(0.001 / g0, Math.min(1, t / durSec));
}

function render(tones) {
  const totalSec = Math.max(...tones.map((t) => t.when + t.durMs / 1000)) + 0.02; // 末尾に無音を少し
  const buf = new Float32Array(Math.ceil(totalSec * SR));
  for (const t of tones) {
    const durSec = t.durMs / 1000;
    const start = Math.round(t.when * SR);
    const n = Math.round(durSec * SR);
    for (let i = 0; i < n; i++) {
      const sec = i / SR;
      buf[start + i] += sample(t.type, 2 * Math.PI * t.freq * sec, t.freq) * envelope(t.gain, sec, durSec);
    }
  }
  return buf;
}

function toWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 2, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const dir = new URL("../public/assets/audio/se/", import.meta.url);
mkdirSync(dir, { recursive: true });
for (const [name, tones] of Object.entries(SE)) {
  const wav = toWav(render(tones));
  writeFileSync(new URL(`${name}.wav`, dir), wav);
  const peak = Math.max(...render(tones).map(Math.abs));
  console.log(`${name}.wav  ${(wav.length / 1024).toFixed(1)}KB  peak=${peak.toFixed(3)}`);
}
