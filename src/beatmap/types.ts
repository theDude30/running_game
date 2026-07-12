export type ObstacleType = 'pit' | 'branch' | 'breakableWall' | 'hardWall' | 'zombie';

export interface BeatEvent {
  /** Seconds into the song when the obstacle reaches the hero. */
  time: number;
  type: ObstacleType;
}

/**
 * Whole-track weather archetype, chosen once from the song's detected key
 * mode and tempo (see beatmap/generate.ts): major+fast (happy/upbeat) gets
 * no precipitation, minor (moody/sad) gets rain, major+slow (calm/bright)
 * gets snow.
 */
export type WeatherType = 'none' | 'rain' | 'snow';

export interface Beatmap {
  name: string;
  bpm: number;
  /** Total song length in seconds. */
  duration: number;
  weatherType: WeatherType;
  /** Sorted by time ascending. */
  events: BeatEvent[];
}

/** Everything GameScene needs for a run; stored in the game registry. */
export interface RunConfig {
  beatmap: Beatmap;
  /** Undefined = silent metronome (test track). */
  audioBuffer?: AudioBuffer;
}
