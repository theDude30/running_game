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
