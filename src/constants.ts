export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;

// Phaser 3 sizes its canvas in CSS pixels and ignores devicePixelRatio, so on
// a 2×/3× display a 960×540 canvas gets CSS-stretched and blurs everything.
// The canvas is therefore created DPR× larger (main.ts) and every scene's
// camera zooms by DPR from the top-left corner (setOrigin(0,0).setZoom(DPR)),
// which keeps all gameplay/scroll coordinates in the fixed 960×540 space.
// Capped at 3 (iPhone-class); higher DPRs cost GPU fill-rate with no visible
// gain at this art scale. Pointer coordinates arrive in canvas pixels and
// must be divided by DPR to compare against logical positions — Phaser's own
// hit-testing handles this, raw pointer.x/y users must do it themselves
// (see InputController).
export const DPR = Math.min(window.devicePixelRatio || 1, 3);

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
export const KICK_DURATION = 0.35; // seconds the kick hitbox stays active
export const KICK_RANGE = 50; // px in front of the hero
export const BLINK_DURATION = 2; // invincibility after a hit

// Timing judgement: |action time - beat time| in seconds
export const RATING_WINDOW = { perfect: 0.07, good: 0.14, ok: 0.25 } as const;

// Branch platform riding: jump on top and walk across instead of ducking.
// Kept generous — a chained staircase climb (see STAIR_STEP_HEIGHT) reuses
// this same tolerance, and its jump apexes only clear each step's height by
// a few px; a tight tolerance turns ordinary spacing jitter between real
// songs' beats into the difference between landing and clipping the step.
export const BRANCH_LAND_TOLERANCE = 40; // px snap tolerance when landing on top

// Flying mode
export const COMBO_TO_FLY = 12; // consecutive clears (any rating) that trigger flight; repeats every N
export const FLIGHT_DURATION = 20; // seconds
export const FLY_GRACE_PERIOD = 2.5; // obstacle-free seconds at the start of each flight, to get a feel for the controls
// Highest altitude the hero can reach. Deliberately close enough to
// FLY_BAND_HIGH that a high-danger dragon's zone still reaches a hero
// pinned at the ceiling (see the FLY_TOP math note by FLY_BAND_HIGH below)
// — sitting at the very top must stay dangerous against dragons flying
// high, or "just hold thrust forever" becomes a free win.
export const FLY_TOP = 136;
export const FLY_BAND_HIGH = 170; // "climb" safe-zone center
export const FLY_BAND_LOW = 350; // "dive" safe-zone center
export const FLY_BAND_TOLERANCE = 60; // how far the hero's CENTER may wander from a band center and stay safe
export const FLY_HITBOX_HEIGHT = 28; // collision-only height while flying (visual stays HERO_HEIGHT — forgiving hitbox)
export const FLY_UP_ACCEL = 2200; // upward acceleration while thrust is held
export const FLY_GRAVITY = 1500; // downward acceleration while thrust is released
export const FLY_MAX_UP_SPEED = 420;
export const FLY_MAX_FALL_SPEED = 480;
export const FLY_ENTRY_SPEED = 550; // initial pop-up velocity when flight starts
export const FLY_MIN_BAND_SWITCH = 0.75; // min seconds between obstacles that demand opposite bands
export const FLY_DRAGON_BOB_AMPLITUDE = 16; // px of vertical bob while flying
export const FLY_DRAGON_BOB_SPEED = 3.4; // rad/sec of the bob cycle
export const FLY_DRAGON_WEAVE_AMPLITUDE = 22; // px of horizontal weave on top of the scroll
export const FLY_DRAGON_WEAVE_SPEED = 2.1; // rad/sec of the weave cycle

// Weather: live FFT analysis of the currently playing music drives a
// particle/fog/lightning layer. See src/audio/WeatherAnalyzer.ts for the
// smoothing/peak-detection math and src/gameplay/WeatherSystem.ts for the
// Phaser-side visuals. Inactive for the silent test track (no real audio).
export const WEATHER_BASS_HZ: readonly [number, number] = [20, 150];
export const WEATHER_TREBLE_HZ: readonly [number, number] = [2000, 12000];
// Smoothing: how fast each metric chases its raw FFT reading per frame
// (higher = snappier, lower = smoother). Emission reacts fast so the game
// still feels tight to the music; fog swells and fades slowly.
export const WEATHER_LERP_BASS = 0.35;
export const WEATHER_LERP_TREBLE = 0.3;
export const WEATHER_LERP_VOLUME = 0.12;
export const WEATHER_LERP_CENTROID = 0.08;
// Peak detection for lightning/gust triggers: fire only when bass spikes
// well above its own rolling average, not on a raw threshold — keeps quiet
// songs sensitive and loud songs from triggering every frame.
export const WEATHER_BEAT_AVG_LERP = 0.06;
export const WEATHER_BEAT_RATIO = 1.5;
export const WEATHER_BEAT_MIN_ENERGY = 0.12;
export const WEATHER_BEAT_MIN_GAP = 0.12; // seconds, however loud
// Visuals — rain (minor-key/moody tracks)
export const WEATHER_COOL_COLOR = 0xbfe9ff; // high spectral centroid (bright treble): icy blue/white
export const WEATHER_WARM_COLOR = 0x6b3fa0; // low spectral centroid (bass-heavy): deep purple/grey
export const WEATHER_RAIN_MIN_FREQUENCY_MS = 18; // emission interval at max bass (dense burst)
export const WEATHER_RAIN_MAX_FREQUENCY_MS = 260; // emission interval at rest (light drizzle)
export const WEATHER_RAIN_MIN_SPEED = 220;
export const WEATHER_RAIN_MAX_SPEED = 620;
export const WEATHER_RAIN_LIFESPAN = 1400;
// Visuals — snow (major-key/calm, slow tracks). Falls slower and drifts
// rather than streaking, and stays a fixed pale color regardless of pitch.
export const WEATHER_SNOW_COLOR = 0xf3f9ff;
export const WEATHER_SNOW_MIN_FREQUENCY_MS = 30;
export const WEATHER_SNOW_MAX_FREQUENCY_MS = 340;
export const WEATHER_SNOW_MIN_SPEED = 40;
export const WEATHER_SNOW_MAX_SPEED = 160;
export const WEATHER_SNOW_LIFESPAN = 3200;

// Floor climbing: a staircase (3 sequential rideable platforms, reusing the
// branch-riding mechanic) lets the hero climb to a higher floor. Purely a
// bonus layer — ignoring a staircase costs nothing. Missing or getting hit
// by anything while elevated drops the hero all the way back to the ground
// floor (see GameScene.fallToGroundFloor).
export const STAIRS_PER_FLOOR = 3;
export const STAIR_STEP_HEIGHT = 90; // matches the existing branch-ride height, so a fresh jump comfortably reaches the next step
export const FLOOR_HEIGHT = STAIRS_PER_FLOOR * STAIR_STEP_HEIGHT;
export const MAX_FLOOR = 4;
export const FLOOR_BONUS = [750, 1500, 3000, 6000] as const; // index 0 = one-time bonus for first reaching floor 1
export const FLOOR_CLIMB_PAN_MS = 500; // smooth camera pan when a staircase completes or flight fast-travels to a floor
export const FLOOR_FALL_MIN_MS = 400;
export const FLOOR_FALL_MAX_MS = 1200;
// Small cycling palette (4 floors) recoloring the ground and each obstacle's
// primary part — staircases themselves stay branch-brown on every floor so
// they're always recognizable as climbable.
export const FLOOR_THEMES: readonly { bg: number; obstacle: number }[] = [
  { bg: 0x1e293b, obstacle: 0x38bdf8 }, // floor 1: Sky — icy blue
  { bg: 0x2e1065, obstacle: 0xa855f7 }, // floor 2: Storm — violet
  { bg: 0x431407, obstacle: 0xf97316 }, // floor 3: Ember — fiery orange
  { bg: 0x022c22, obstacle: 0x4ade80 }, // floor 4: Void — neon green
];

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
  lava: 0xc2410c,
  lavaGlow: 0xfacc15,
  lavaRock: 0x3f1d0f,
} as const;
