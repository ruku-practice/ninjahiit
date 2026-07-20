// タイマーエンジン：絶対時刻（nowで注入可能・既定performance.now()）基準で残時間を計算する
// （setIntervalのズレに依存しない。rAFは使わない＝非表示タブ/バックグラウンドで停止しても復帰時に正しく再同期できる）

export class WorkoutEngine {
  handlers: { onTick: Function; onSegmentChange: Function; onFinish: Function };
  segments: any[];
  index: number;
  timerId: ReturnType<typeof setInterval> | null;
  segStart: number;
  pausedAt: number | null;
  finished: boolean;
  now: () => number;

  // workout: {workSec, restSec, rounds, setRestSec, exercises[]}
  // finisherSec > 0 のとき、末尾に仕上げプランク(work)を追加する
  // now: 時計の蛇口（既定=performance.now）。テストでは決定的な値を注入する
  constructor(workout, prepareSec, handlers, finisherSec = 0, now: () => number = () => performance.now()) {
    this.handlers = handlers; // {onTick, onSegmentChange, onFinish}
    this.segments = WorkoutEngine.buildSegments(workout, prepareSec, finisherSec);
    this.now = now;
    this.index = 0;
    this.timerId = null;
    this.segStart = 0;      // 現セグメント開始時刻（this.now()基準）
    this.pausedAt = null;
    this.finished = false;
  }

  static buildSegments(w, prepareSec, finisherSec = 0) {
    const seq = [];
    for (let r = 0; r < w.rounds; r++) for (const ex of w.exercises) seq.push({ ex, sec: w.workSec });
    if (finisherSec > 0) seq.push({ ex: "plank", sec: finisherSec, finisher: true });
    const total = seq.length;
    const segs = [];
    segs.push({ type: "prepare", sec: prepareSec, exercise: seq[0].ex, slot: 1, total });
    seq.forEach((item, i) => {
      segs.push({ type: "work", sec: item.sec, exercise: item.ex, slot: i + 1, total, finisher: !!(item as any).finisher });
      const isLast = i === total - 1;
      if (!isLast) {
        const endOfRound = (i + 1) % w.exercises.length === 0;
        const restSec = endOfRound && w.setRestSec > 0 ? w.setRestSec : w.restSec;
        if (restSec > 0) {
          // restは「次の種目」を予告する区間なので、次が仕上げならフラグを引き継ぐ
          segs.push({ type: "rest", sec: restSec, exercise: seq[i + 1].ex, slot: i + 2, total, finisher: !!(seq[i + 1] as any).finisher });
        }
      }
    });
    return segs;
  }

  get current() { return this.segments[this.index]; }
  get next() {
    for (let i = this.index + 1; i < this.segments.length; i++) {
      if (this.segments[i].type === "work") return this.segments[i];
    }
    return null;
  }
  get totalWorkSec() {
    return this.segments.filter(s => s.type === "work").reduce((a, s) => a + s.sec, 0);
  }

  start() {
    this.segStart = this.now();
    this.handlers.onSegmentChange(this.current, this.next);
    this.timerId = setInterval(() => this._tick(), 100);
  }

  pause() {
    if (this.pausedAt !== null || this.finished) return;
    this.pausedAt = this.now();
    clearInterval(this.timerId);
  }

  resume() {
    if (this.pausedAt === null || this.finished) return;
    this.segStart += this.now() - this.pausedAt;
    this.pausedAt = null;
    this.timerId = setInterval(() => this._tick(), 100);
  }

  stop() {
    clearInterval(this.timerId);
    this.finished = true;
  }

  // 1回のtickで複数セグメント分の経過をまとめて消化する（バックグラウンド復帰などで
  // 一度に長い時間が経過していても、通過したはずのセグメントを1つ飛ばしで無かったことに
  // せず、正しく全て消化してから現在のセグメントの残り時間を計算する）
  _tick() {
    let seg = this.current;
    let elapsed = (this.now() - this.segStart) / 1000;
    let remain = seg.sec - elapsed;
    while (remain <= 0) {
      const overrun = -remain; // 次のセグメントに繰り越す超過分（秒）
      this.index++;
      if (this.index >= this.segments.length) {
        this.stop();
        this.handlers.onFinish();
        return;
      }
      // 新セグメントの開始点を「超過分だけ過去」にずらし、実経過時間を正しく引き継ぐ
      this.segStart = this.now() - overrun * 1000;
      seg = this.current;
      this.handlers.onSegmentChange(seg, this.next);
      elapsed = (this.now() - this.segStart) / 1000;
      remain = seg.sec - elapsed;
    }
    this.handlers.onTick(seg, remain, elapsed / seg.sec);
  }
}
