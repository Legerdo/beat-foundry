// Lookahead scheduler: a timer wakes up often and schedules every 16th step that falls
// inside the lookahead window on the audio clock. Rendering never drives timing.

const LOOKAHEAD = 0.14;
const INTERVAL_MS = 25;

export class Transport {
  bpm = 100;
  stepDur = 0.15;
  /** Audio time of global step 0. */
  origin = 0;
  private next = 0;
  private timer: number | null = null;

  constructor(
    private ctx: AudioContext,
    private onStep: (index: number, time: number) => void,
  ) {}

  get running(): boolean {
    return this.timer !== null;
  }

  start(bpm: number, delay = 0.12): void {
    this.stop();
    this.bpm = bpm;
    this.stepDur = 60 / bpm / 4;
    this.origin = this.ctx.currentTime + delay;
    this.next = 0;
    this.resume();
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  /** Continue the existing sequence without resetting its origin or next step. */
  resume(): void {
    if (this.running) return;
    this.timer = window.setInterval(() => this.tick(), INTERVAL_MS);
    this.tick();
  }

  timeOfStep(i: number): number {
    return this.origin + i * this.stepDur;
  }

  /** Fractional global step index at an audio time. */
  stepAt(time: number): number {
    return (time - this.origin) / this.stepDur;
  }

  /** Index of the next step that has not been scheduled yet. */
  get nextIndex(): number {
    return this.next;
  }

  private tick(): void {
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    // If the clock jumped (e.g. device change), skip ahead instead of flooding.
    if (this.timeOfStep(this.next) < this.ctx.currentTime - 0.25) {
      this.next = Math.ceil(this.stepAt(this.ctx.currentTime)) + 1;
      // keep bar alignment
      this.next = Math.ceil(this.next / 16) * 16;
    }
    while (this.timeOfStep(this.next) < horizon) {
      this.onStep(this.next, this.timeOfStep(this.next));
      this.next++;
    }
  }
}
