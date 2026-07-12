export type ObstacleType = 'pit' | 'branch' | 'breakableWall' | 'hardWall' | 'zombie';

export interface BeatEvent {
  /** Seconds into the song when the obstacle reaches the hero. */
  time: number;
  type: ObstacleType;
}

export interface Beatmap {
  name: string;
  bpm: number;
  /** Total song length in seconds. */
  duration: number;
  /** Sorted by time ascending. */
  events: BeatEvent[];
}

/** Everything GameScene needs for a run; stored in the game registry. */
export interface RunConfig {
  beatmap: Beatmap;
  /** Undefined = silent metronome (test track). */
  audioBuffer?: AudioBuffer;
}
