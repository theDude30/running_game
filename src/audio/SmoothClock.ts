/**
 * The "two clocks" technique (web.dev "A Tale of Two Clocks", StepMania,
 * osu!): AudioContext.currentTime is authoritative but advances in audio
 * render-quantum steps (~3ms stairs), which reads as micro-jitter when
 * sampled per display frame. performance.now() is buttery-smooth but drifts
 * from the audio hardware. So: run game time on performance.now(), and
 * continuously re-calibrate it against the *heard* audio position.
 *
 * getOutputTimestamp() pairs a context time with the performance.now()
 * moment that audio actually left the speakers — so output latency is
 * accounted for automatically. Falls back to currentTime minus reported
 * latency where unsupported.
 */
export class SmoothClock {
  private offset: number | null = null; // perf-seconds minus heard-context-seconds
  private last: number | null = null; // monotonicity clamp (StepMania-style)

  constructor(private readonly ctx: AudioContext) {}

  /** Context time of the sample the listener is hearing right now. */
  private heardTime(): number {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.contextTime > 0) {
      // advance the paired snapshot to "now" using the perf clock
      return ts.contextTime + (performance.now() - (ts.performanceTime ?? 0)) / 1000;
    }
    const latency =
      (this.ctx.baseLatency || 0) +
      ((this.ctx as AudioContext & { outputLatency?: number }).outputLatency || 0);
    return this.ctx.currentTime - latency;
  }

  /** Smooth, drift-corrected heard-audio time. Safe to call every frame. */
  now(): number {
    const heard = this.heardTime();
    if (this.ctx.state !== 'running') {
      // suspended/paused: follow the frozen audio clock exactly
      this.offset = null;
      this.last = null;
      return heard;
    }
    const perf = performance.now() / 1000;
    const raw = perf - heard;
    if (this.offset === null || Math.abs(raw - this.offset) > 0.05) {
      this.offset = raw; // first frame or a real discontinuity: snap
      this.last = null;
    } else {
      this.offset += (raw - this.offset) * 0.03; // gentle drift correction
    }
    let t = perf - this.offset;
    // never step backwards (drift correction may pull slightly against us)
    if (this.last !== null && t < this.last) t = this.last;
    this.last = t;
    return t;
  }
}
