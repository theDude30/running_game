export type ObstacleType = 'pit' | 'branch' | 'breakableWall' | 'hardWall' | 'zombie' | 'lava';

export interface BeatEvent {
  /** Seconds into the song when the obstacle reaches the hero. */
  time: number;
  type: ObstacleType;
  /**
   * Set only on the 3 'branch' events that form a staircase (1/2/3, low to
   * high). Riding tier 3 climbs the hero to the next floor — see
   * FLOOR_HEIGHT/STAIR_STEP_HEIGHT in constants.ts.
   */
  stairTier?: number;
}

/**
 * Whole-track weather archetype, chosen once from the song's detected key
 * mode and tempo (see beatmap/generate.ts): major+fast (happy/upbeat) gets
 * no precipitation, minor (moody/sad) gets rain, major+slow (calm/bright)
 * gets snow.
 */
export type WeatherType = 'none' | 'rain' | 'snow';

/**
 * How high off the ground a star sits, which is what makes it easy/medium/
 * hard: easy is body-height (collected just by running), medium needs a
 * timed single jump, hard needs a timed double jump. No button-press
 * timing involved — purely "be in the right place," unlike obstacles.
 */
export type StarTier = 'easy' | 'medium' | 'hard';

export interface StarEvent {
  /** Seconds into the song when the star reaches the hero. */
  time: number;
  tier: StarTier;
}

export interface Beatmap {
  name: string;
  bpm: number;
  /** Total song length in seconds. */
  duration: number;
  weatherType: WeatherType;
  /** Sorted by time ascending. */
  events: BeatEvent[];
  /** Sorted by time ascending. Capped at 20 per track regardless of length. */
  stars: StarEvent[];
}

/** Everything GameScene needs for a run; stored in the game registry. */
export interface RunConfig {
  beatmap: Beatmap;
  /** Undefined = silent metronome (test track). */
  audioBuffer?: AudioBuffer;
}
