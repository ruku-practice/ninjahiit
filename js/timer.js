// タイマーエンジン：performance.now() 基準で残時間を計算する（setIntervalのズレに依存しない）

class WorkoutEngine {
  // workout: {workSec, restSec, rounds, setRestSec, exercises[]}
  constructor(workout, prepareSec, handlers) {
    this.handlers = handlers; // {onTick, onSegmentChange, onFinish}
    this.segments = WorkoutEngine.buildSegments(workout, prepareSec);
    this.index = 0;
    this.timerId = null;
    this.segStart = 0;      // 現セグメント開始時刻（performance.now）
    this.pausedAt = null;
    this.finished = false;
  }

  static buildSegments(w, prepareSec) {
    const seq = [];
    for (let r = 0; r < w.rounds; r++) for (const ex of w.exercises) seq.push(ex);
    const total = seq.length;
    const segs = [];
    segs.push({ type: "prepare", sec: prepareSec, exercise: seq[0], slot: 1, total });
    seq.forEach((ex, i) => {
      segs.push({ type: "work", sec: w.workSec, exercise: ex, slot: i + 1, total });
      const isLast = i === total - 1;
      if (!isLast) {
        const endOfRound = (i + 1) % w.exercises.length === 0;
        const restSec = endOfRound && w.setRestSec > 0 ? w.setRestSec : w.restSec;
        if (restSec > 0) {
          segs.push({ type: "rest", sec: restSec, exercise: seq[i + 1], slot: i + 2, total });
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
