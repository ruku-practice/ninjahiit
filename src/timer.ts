// タイマーエンジン：performance.now() 基準で残時間を計算する（setIntervalのズレに依存しない）

export class WorkoutEngine {
  handlers: { onTick: Function; onSegmentChange: Function; onFinish: Function };
  segments: any[];
  index: number;
  timerId: ReturnType<typeof setInterval> | null;
  segStart: number;
  pausedAt: number | null;
  finished: boolean;

  // workout: {workSec, restSec, rounds, setRestSec, exercises[]}
  // finisherSec > 0 のとき、末尾に仕上げプランク(work)を追加する
  constructor(workout, prepareSec, handlers, finisherSec = 0) {
    this.handlers = handlers; // {onTick, onSegmentChange, onFinish}
    this.segments = WorkoutEngine.buildSegments(workout, prepareSec, finisherSec);
    this.index = 0;
    this.timerId = null;
    this.segStart = 0;      // 現セグメント開始時刻（performance.now）
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
    this.segStart = performance.now();
    this.handlers.onSegmentChange(this.current, this.next);
    this.timerId = setInterval(() => this._tick(), 100);
  }

  pause() {
    if (this.pausedAt !== null || this.finished) return;
    this.pausedAt = performance.now();
    clearInterval(this.timerId);
  }

  resume() {
    if (this.pausedAt === null || this.finished) return;
    this.segStart += performance.now() - this.pausedAt;
    this.pausedAt = null;
    this.timerId = setInterval(() => this._tick(), 100);
  }

  stop() {
    clearInterval(this.timerId);
    this.finished = true;
  }

  _tick() {
    const seg = this.current;
    const elapsed = (performance.now() - this.segStart) / 1000;
    const remain = seg.sec - elapsed;
    if (remain <= 0) {
      this.index++;
      if (this.index >= this.segments.length) {
        this.stop();
        this.handlers.onFinish();
        return;
      }
      this.segStart = performance.now();
      this.handlers.onSegmentChange(this.current, this.next);
      this.handlers.onTick(this.current, this.current.sec, 0);
      return;
    }
    this.handlers.onTick(seg, remain, elapsed / seg.sec);
  }
}
