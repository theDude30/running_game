/**
 * Master clock for the whole game. Everything that moves is positioned from
 * `songTime`, never from frame deltas, so the level can not drift from the
 * music. Phase 1 uses a silent performance.now()-based metronome; Phase 2
 * swaps the time source for AudioContext.currentTime without changing any
 * consumer code.
 */
export class Conductor {
  private startAt = 0; // epoch (in now() seconds) where songTime === 0
  private pausedAt: number | null = null;

  constructor(readonly bpm: number) {}

  private now(): number {
    return performance.now() / 1000;
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
   * throttling, app switch, GC pause). Keeps songTime continuous with the
   * frames the player actually saw instead of teleporting the level.
   */
  compensate(seconds: number): void {
    this.startAt += seconds;
  }

  get beatDuration(): number {
    return 60 / this.bpm;
  }

  /** Whole beats elapsed since the song started (negative pre-start). */
  get beatsElapsed(): number {
    return Math.floor(this.songTime / this.beatDuration);
  }
}
