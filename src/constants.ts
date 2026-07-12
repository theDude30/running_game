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

// Branch platform riding: jump on top and walk across instead of ducking
export const BRANCH_LAND_TOLERANCE = 14; // px snap tolerance when landing on top

// Flying mode
export const COMBO_TO_FLY = 3; // consecutive clears (any rating) that trigger flight; repeats every N
export const FLIGHT_DURATION = 20; // seconds
export const FLY_TOP = 70; // highest altitude the hero can reach
export const FLY_BAND_HIGH = 170; // "climb" safe-zone center (wall obstacles)
export const FLY_BAND_LOW = 350; // "dive" safe-zone center (dragon obstacles)
export const FLY_BAND_TOLERANCE = 60; // how far the hero's CENTER may wander from a band center and stay safe
export const FLY_HITBOX_HEIGHT = 28; // collision-only height while flying (visual stays HERO_HEIGHT — forgiving hitbox)
export const FLY_UP_ACCEL = 2200; // upward acceleration while thrust is held
export const FLY_GRAVITY = 1500; // downward acceleration while thrust is released
export const FLY_MAX_UP_SPEED = 420;
export const FLY_MAX_FALL_SPEED = 480;
export const FLY_ENTRY_SPEED = 550; // initial pop-up velocity when flight starts
export const FLY_MIN_BAND_SWITCH = 0.75; // min seconds between obstacles that demand opposite bands

export const COLORS = {
  bg: 0x0a0a12,
  ground: 0x2d2d44,
  hero: 0x4ade80,
  heroKick: 0xfacc15,
  heroFlying: 0x38bdf8,
  pit: 0x991b1b,
  branch: 0x92400e,
  breakableWall: 0x9ca3af,
  crack: 0x4b5563,
  hardWall: 0x475569,
  zombie: 0x15803d,
  zombieEyes: 0xdc2626,
  flyWall: 0x64748b,
  flyDragon: 0xdc2626,
} as const;
