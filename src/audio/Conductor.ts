/** Monotonic clock in seconds. */
export type TimeSource = () => number;

/**
 * Master clock for the whole game. Everything that moves is positioned from
 * `songTime`, never from frame deltas, so the level can not drift from the
 * music.
 *
 * Two modes:
 *  - wall-clock (silent metronome): performance.now()-based; render stalls
 *    must be compensated so the level doesn't teleport.
 *  - audio: AudioContext.currentTime-based; the clock IS the music, so it is
 *    never compensated (suspending the context freezes it instead).
 */
export class Conductor {
  private startAt = 0; // epoch (in timeSource seconds) where songTime === 0
  private pausedAt: number | null = null;

  constructor(
    readonly bpm: number,
    private readonly timeSource: TimeSource = () => performance.now() / 1000,
    /** Whether render-stall compensation is allowed (wall-clock mode only). */
    readonly compensable = true,
  ) {}

  private now(): number {
    return this.timeSource();
  }

  /** Begin the track `delay` seconds from now (used for the countdown). */
  startIn(delay: number): void {
    this.startAt = this.now() + delay;
    this.pausedAt = null;
  }

  /** Seconds into the song. Negative while the countdown is running. */
  get songTime(): number {
    return (this.pausedAt ?? this.now()) - this.startAt;
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  pause(): void {
    if (this.pausedAt === null) this.pausedAt = this.now();
  }

  resume(): void {
    if (this.pausedAt !== null) {
      this.startAt += this.now() - this.pausedAt;
      this.pausedAt = null;
    }
  }

  /**
   * Shift the clock forward by `seconds` to swallow a render stall (tab
   * throttling, app switch, GC pause). No-op in audio mode: the music kept
   * playing, so the clock must not move.
   */
  compensate(seconds: number): void {
    if (this.compensable) this.startAt += seconds;
  }

  get beatDuration(): number {
    return 60 / this.bpm;
  }
}
