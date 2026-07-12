import type { Beatmap, BeatEvent, ObstacleType, StarEvent } from './types';

/**
 * Hand-authored Phase 1 test track: 120 BPM, 48 seconds, silent metronome.
 * Sections introduce each obstacle type, then mix them, then get dense —
 * a stand-in for what audio analysis will produce in Phase 2.
 */
const BPM = 120;
const BEAT = 60 / BPM;

function section(events: BeatEvent[], startBeat: number, step: number, types: ObstacleType[]): void {
  types.forEach((type, i) => {
    events.push({ time: (startBeat + i * step) * BEAT, type });
  });
}

function build(): Beatmap {
  const events: BeatEvent[] = [];

  // Warm-up: one skill at a time
  section(events, 8, 2, ['pit', 'pit', 'pit', 'pit']);
  section(events, 16, 2, ['branch', 'branch', 'branch', 'branch']);
  section(events, 24, 2, ['pit', 'branch', 'pit', 'branch']);
  section(events, 32, 2, ['zombie', 'zombie', 'zombie', 'zombie']);
  section(events, 40, 4, ['breakableWall', 'breakableWall']);
  section(events, 48, 2, ['hardWall', 'pit', 'hardWall', 'pit']);

  // Mixed, still relaxed
  section(events, 56, 2, [
    'zombie',
    'branch',
    'pit',
    'zombie',
    'breakableWall',
    'branch',
    'pit',
    'hardWall',
  ]);

  // Dense finale: every 1.5 beats
  section(events, 72, 1.5, [
    'pit',
    'branch',
    'pit',
    'zombie',
    'branch',
    'pit',
    'branch',
    'zombie',
    'pit',
  ]);

  // Cool-down
  section(events, 88, 2, ['pit', 'branch', 'pit']);

  events.sort((a, b) => a.time - b.time);

  // Easy stars are placed on beats with no jump-forcing obstacle nearby
  // (the branch/zombie sections) — see generate.ts for why: a coincidence
  // with a jump-forcing obstacle can carry the hero above an "easy" star's
  // body-height band right when it arrives.
  const stars: StarEvent[] = [
    { time: 17 * BEAT, tier: 'easy' },
    { time: 20 * BEAT, tier: 'medium' },
    { time: 36 * BEAT, tier: 'hard' },
    { time: 33 * BEAT, tier: 'easy' },
    { time: 64 * BEAT, tier: 'medium' },
    { time: 80 * BEAT, tier: 'hard' },
  ];

  return { name: 'Test Track', bpm: BPM, duration: 96 * BEAT, weatherType: 'none', events, stars };
}

export const testBeatmap: Beatmap = build();
