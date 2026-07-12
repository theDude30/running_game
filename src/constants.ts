export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;

// World geometry (fixed internal coordinates, see Scale.FIT in main.ts)
export const GROUND_TOP = 460;
export const HERO_X = 160;

// Movement tuning
export const SCROLL_SPEED = 420; // px/sec — world speed toward the hero
export const GRAVITY = 2600;
export const JUMP_VELOCITY = -950;
export const STOMP_BOUNCE = -600;

// Hero shape
export const HERO_WIDTH = 44;
export const HERO_HEIGHT = 64;
export const DUCK_HEIGHT = 34;

// Actions
export const KICK_DURATION = 0.18; // seconds the kick hitbox stays active
export const KICK_RANGE = 50; // px in front of the hero
export const BLINK_DURATION = 2; // invincibility after a hit

// Timing judgement: |action time - beat time| in seconds
export const RATING_WINDOW = { perfect: 0.07, good: 0.14, ok: 0.25 } as const;

export const COLORS = {
  bg: 0x0a0a12,
  ground: 0x2d2d44,
  hero: 0x4ade80,
  heroKick: 0xfacc15,
  pit: 0x991b1b,
  branch: 0x92400e,
  breakableWall: 0x9ca3af,
  crack: 0x4b5563,
  hardWall: 0x475569,
  zombie: 0x15803d,
  zombieEyes: 0xdc2626,
} as const;
