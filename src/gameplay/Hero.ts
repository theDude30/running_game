import Phaser from 'phaser';
import {
  BLINK_DURATION,
  DUCK_HEIGHT,
  FLY_ENTRY_SPEED,
  FLY_GRAVITY,
  FLY_HITBOX_HEIGHT,
  FLY_MAX_FALL_SPEED,
  FLY_MAX_UP_SPEED,
  FLY_TOP,
  FLY_UP_ACCEL,
  GRAVITY,
  GROUND_TOP,
  HERO_HEIGHT,
  HERO_WIDTH,
  HERO_X,
  JUMP_VELOCITY,
  KICK_DURATION,
  KICK_RANGE,
  SCROLL_SPEED,
  STOMP_BOUNCE,
} from '../constants';
import motorcycleBodyUrl from '../assets/hero/motorcycle-body.png';
import duckUrl from '../assets/hero/duck.png';
import jumpUrl from '../assets/hero/jump.png';

/**
 * Animation frames extracted from the source clips at their native 24fps
 * (see docs/asset-quality-plan.md for the extraction pipeline). Filenames
 * are zero-padded so lexicographic key order IS playback order.
 */
function frameUrls(glob: Record<string, string>): string[] {
  return Object.keys(glob)
    .sort()
    .map((k) => glob[k]);
}
const FIRE_FRAME_URLS = frameUrls(
  import.meta.glob('../assets/hero/fire-*.png', { eager: true, import: 'default' }) as Record<
    string,
    string
  >,
);
const FLY_FRAME_URLS = frameUrls(
  import.meta.glob('../assets/hero/fly-*.png', { eager: true, import: 'default' }) as Record<
    string,
    string
  >,
);
// One full wing-flap cycle: frames 73–95 of the source clip (every 2nd frame,
// picked by SSIM for the cleanest loop seam), so the loop plays forward at
// the clip's natural flap speed instead of yoyo-ing a half cycle.
const FLY_CYCLE_MS = 1000;

// Sprite art is square and includes flowing hair/guitar that extends well
// beyond the hitbox, so the visual size is scaled up independently of
// HERO_WIDTH/HERO_HEIGHT (which stay pure hitbox dimensions).
const SPRITE_SCALE = 1.9;

// The motorcycle source image is a wide side-on illustration (not a human
// silhouette), so it needs its own scale rather than SPRITE_SCALE — using
// the human scale made the bike enormous, since the same target HEIGHT
// produces a much greater WIDTH at this image's ~1.4:1 aspect ratio.
// Tuned so the BIKE (wheel diameter) renders at the same world size it had
// with the previous texture, whose rider sat lower relative to the wheels.
const MOTORCYCLE_SPRITE_SCALE = 1.58;

// The source clip had no real riding animation (see project history) — every
// frame was the same static pose. A procedural sine-wave bob on vertical
// position was tried (at a couple of different speeds/amplitudes) to fake
// life into the still pose, but it read as jittery/jumpy regardless of
// tuning, so the body just holds perfectly still now; only the exhaust
// smoke moves.

// Tried cropping the front wheel out of the source photo as its own
// spinning sub-sprite, but the fork/caliper attach right at the axle and
// cover a large wedge of the wheel's circular footprint in the source art
// — excluding them left a visible gap that rotated through the tire, and
// attempting to fill that gap from the diametrically-opposite part of the
// wheel (assuming rotational symmetry) produced visible ghosting instead,
// since the spoke/rotor layout isn't actually symmetric.
//
// A brand-new, self-drawn "spinner" graphic sidesteps that entirely: since
// it isn't extracted from the source photo, it has no fork/caliper baked
// into it to conflict with, so it rotates cleanly. Layered on top of the
// (still static) wheel in the body image at low opacity, it reads as a
// chrome spinner-blade accessory and gives the wheel a genuine rotation
// cue. Coordinates are pixel positions in the 746x550 body texture
// (see motorcycle-body.png; the fire-kick frames share this bike geometry
// so the bike doesn't shift when the kick texture swaps in).
const MOTORCYCLE_BODY_TEX_SIZE = { width: 746, height: 550 };
const MOTORCYCLE_FRONT_WHEEL_CENTER = { x: 640, y: 444 };
const MOTORCYCLE_REAR_WHEEL_CENTER = { x: 125, y: 458 };
const MOTORCYCLE_WHEEL_RADIUS = 101; // shared approximation — both wheels are close to this size
const MOTORCYCLE_SPINNER_TEX_RADIUS = 98; // radius the spike tips are drawn at within their own texture
const MOTORCYCLE_SPINNER_TEX_SIZE = 200;
const MOTORCYCLE_WHEEL_SPIN_SPEED = 14; // radians/sec — both wheels spin in sync, like a real bike

// Approximate exhaust outlet position (same coordinate space as above) for
// the smoke puff emitter.
const MOTORCYCLE_EXHAUST_POSITION = { x: 95, y: 488 };

// Wind streaks around the rider's head/torso, rushing past leftward (the
// same direction the scrolling world moves) faster than the world itself
// scrolls, so the bike reads as actively cutting through the air rather
// than just sitting in front of a moving background.
const MOTORCYCLE_WIND_POSITION = { x: 299, y: 173 };
const MOTORCYCLE_WIND_SPREAD = { x: 90, y: 110 }; // random offset range around the anchor above
const MOTORCYCLE_WIND_SPEED = SCROLL_SPEED * 1.6;

// The duck pose can't use SPRITE_SCALE like the others: the branch obstacle
// (see obstacles.ts BRANCH_HEIGHT/cy) only leaves 40px of clearance above
// the ground, so the crouched sprite must render at or under that height or
// it visually pokes through the wall even though the (correct) hitbox
// clears it. Capped a couple px under 40 for a safety margin.
const DUCK_SPRITE_SIZE = 38;

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export type HeroMode = 'ground' | 'flying';

/**
 * The auto-running hero. Horizontal position is fixed (the world scrolls);
 * vertical motion is simple deterministic kinematics — timing precision
 * matters more here than physics-engine features.
 */
export class Hero {
  private static readonly TEX_MOTORCYCLE_BODY = 'hero-motorcycle-body';
  private static readonly TEX_DUCK = 'hero-duck';
  private static readonly TEX_JUMP = 'hero-jump';
  private static readonly FIRE_FRAME_KEYS = FIRE_FRAME_URLS.map((_, i) => `hero-fire-${i}`);
  private static readonly ANIM_FIRE = 'hero-fire-anim';
  private static readonly FLY_FRAME_KEYS = FLY_FRAME_URLS.map((_, i) => `hero-fly-${i}`);
  private static readonly ANIM_FLY = 'hero-fly-anim';

  static preload(scene: Phaser.Scene): void {
    scene.load.image(Hero.TEX_MOTORCYCLE_BODY, motorcycleBodyUrl);
    scene.load.image(Hero.TEX_DUCK, duckUrl);
    scene.load.image(Hero.TEX_JUMP, jumpUrl);
    Hero.FIRE_FRAME_KEYS.forEach((key, i) => scene.load.image(key, FIRE_FRAME_URLS[i]));
    Hero.FLY_FRAME_KEYS.forEach((key, i) => scene.load.image(key, FLY_FRAME_URLS[i]));
  }

  readonly display: Phaser.GameObjects.Sprite;
  private readonly smokeEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly windEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly frontWheelSpinner: Phaser.GameObjects.Image;
  private readonly rearWheelSpinner: Phaser.GameObjects.Image;
  private wheelSpinAngle = 0;
  private mode: HeroMode = 'ground';
  private velY = 0;
  private jumpsUsed = 0;
  private feetY = GROUND_TOP;
  private flyY = GROUND_TOP;
  private thrusting = false;
  private ducking = false;
  private kickUntil = -Infinity;
  private blinkUntil = -Infinity;

  constructor(scene: Phaser.Scene) {
    this.display = scene.add.sprite(HERO_X, GROUND_TOP, Hero.TEX_MOTORCYCLE_BODY).setOrigin(0.5, 1);
    this.display.setDisplaySize(HERO_HEIGHT * SPRITE_SCALE, HERO_HEIGHT * SPRITE_SCALE);
    if (!scene.anims.exists(Hero.ANIM_FIRE)) {
      // 8 consecutive source frames from the sustained-blast section, all
      // rendered on one shared bike-aligned canvas (the bike sits at the
      // same relative position/scale as in motorcycle-body.png, flame
      // extending right), so the bike doesn't shift when the texture swaps
      // in and out or between frames. Duration matches KICK_DURATION, which
      // at 8 frames ≈ the clip's native 24fps flicker.
      scene.anims.create({
        key: Hero.ANIM_FIRE,
        frames: Hero.FIRE_FRAME_KEYS.map((key) => ({ key })),
        duration: KICK_DURATION * 1000,
        repeat: 0,
      });
    }
    if (!scene.anims.exists(Hero.ANIM_FLY)) {
      // One full flap cycle (see FLY_CYCLE_MS) looping forward — flight
      // lasts FLIGHT_DURATION (20s), far longer than one cycle. A forward
      // loop of the complete cycle replaced the old 4-frame yoyo: real wing
      // beats aren't time-symmetric, so the yoyo read as mechanical.
      scene.anims.create({
        key: Hero.ANIM_FLY,
        frames: Hero.FLY_FRAME_KEYS.map((key) => ({ key })),
        duration: FLY_CYCLE_MS,
        repeat: -1,
      });
    }
    this.smokeEmitter = buildSmokeEmitter(scene);
    this.windEmitter = buildWindEmitter(scene);
    const spinnerTexture = buildWheelSpinnerTexture(scene);
    this.frontWheelSpinner = scene.add
      .image(HERO_X, GROUND_TOP, spinnerTexture)
      .setOrigin(0.5, 0.5);
    this.rearWheelSpinner = scene.add.image(HERO_X, GROUND_TOP, spinnerTexture).setOrigin(0.5, 0.5);
  }

  private get height(): number {
    return this.ducking ? DUCK_HEIGHT : HERO_HEIGHT;
  }

  get flying(): boolean {
    return this.mode === 'flying';
  }

  get bounds(): Box {
    if (this.mode === 'flying') {
      // Collision-only hitbox smaller than the HERO_HEIGHT visual — a
      // forgiving hitbox, since band-gap tolerance is defined in terms of
      // how far the hero's CENTER may wander (see flyingObstacles.ts).
      return {
        left: HERO_X - HERO_WIDTH / 2,
        right: HERO_X + HERO_WIDTH / 2,
        top: this.flyY - FLY_HITBOX_HEIGHT / 2,
        bottom: this.flyY + FLY_HITBOX_HEIGHT / 2,
      };
    }
    return {
      left: HERO_X - HERO_WIDTH / 2,
      right: HERO_X + HERO_WIDTH / 2,
      top: this.feetY - this.height,
      bottom: this.feetY,
    };
  }

  /** @returns true if a jump actually happened (max double jump). */
  jump(): boolean {
    if (this.mode !== 'ground' || this.jumpsUsed >= 2) return false;
    this.jumpsUsed += 1;
    this.velY = JUMP_VELOCITY;
    return true;
  }

  /** Small upward bounce after stomping a zombie; re-arms one air jump. */
  bounce(): void {
    this.velY = STOMP_BOUNCE;
    this.jumpsUsed = 1;
  }

  setDuck(on: boolean): void {
    this.ducking = on;
  }

  kick(now: number): void {
    this.kickUntil = now + KICK_DURATION;
    this.display.play(Hero.ANIM_FIRE);
  }

  isKicking(now: number): boolean {
    return this.mode === 'ground' && now <= this.kickUntil;
  }

  /** Active kick hitbox in front of the hero, or null when not kicking. */
  kickBox(now: number): Box | null {
    if (!this.isKicking(now)) return null;
    const b = this.bounds;
    return {
      left: b.right,
      right: b.right + KICK_RANGE,
      top: this.feetY - 56,
      bottom: this.feetY - 6,
    };
  }

  isBlinking(now: number): boolean {
    return now <= this.blinkUntil;
  }

  startBlink(now: number): void {
    this.blinkUntil = now + BLINK_DURATION;
  }

  /**
   * Enter flying mode with an upward pop. Always launches from a fixed
   * baseline rather than the current feetY — triggering mid-jump (hero
   * already elevated) must not stack with the pop and rocket the hero into
   * the ceiling.
   */
  enterFlight(): void {
    this.mode = 'flying';
    this.ducking = false;
    this.flyY = GROUND_TOP - HERO_HEIGHT / 2 - 30;
    this.velY = -FLY_ENTRY_SPEED;
    this.thrusting = false;
    this.display.play(Hero.ANIM_FLY);
  }

  /**
   * Return to the ground run (forced landing, whether by timeout or a hit).
   * @param groundY Ground level to land on — the current floor's, so a
   *   successful flight can fast-travel back to a floor climbed earlier.
   */
  exitFlight(groundY: number = GROUND_TOP): void {
    this.mode = 'ground';
    this.feetY = groundY;
    this.velY = 0;
    this.jumpsUsed = 0;
    // Unlike the kick's one-shot fire animation, the flap loops forever
    // (repeat: -1) and would never stop on its own — left playing, it'd
    // keep asserting a fly texture frame every tick and fight the ground
    // branch's setTexture below.
    this.display.stop();
  }

  setThrust(on: boolean): void {
    this.thrusting = on;
  }

  get flyAltitude(): number {
    return this.flyY;
  }

  /** True once the hero has sunk back down to ground level while flying. */
  get touchingGround(): boolean {
    return this.mode === 'flying' && this.flyY >= GROUND_TOP - 1;
  }

  /**
   * @param floorY Ground-mode only: the surface the hero rests on this frame
   *   (GROUND_TOP normally, or an obstacle's top when riding it as a platform).
   */
  update(dt: number, now: number, floorY: number = GROUND_TOP): void {
    if (this.mode === 'flying') {
      const accel = this.thrusting ? -FLY_UP_ACCEL : FLY_GRAVITY;
      this.velY = Phaser.Math.Clamp(this.velY + accel * dt, -FLY_MAX_UP_SPEED, FLY_MAX_FALL_SPEED);
      this.flyY = Phaser.Math.Clamp(this.flyY + this.velY * dt, FLY_TOP, GROUND_TOP);
    } else {
      this.velY += GRAVITY * dt;
      this.feetY += this.velY * dt;
      if (this.feetY >= floorY) {
        this.feetY = floorY;
        this.velY = 0;
        this.jumpsUsed = 0;
      }
    }

    let riding = false;
    if (this.mode === 'flying') {
      // The flap animation (started in enterFlight()) drives the texture
      // frame-by-frame — setting one explicitly here would fight it.
      this.display.setOrigin(0.5, 0.5);
      // Full bike+rider+wings illustration, same aspect family as
      // motorcycle-body.png — see the scale comment below for why that
      // means MOTORCYCLE_SPRITE_SCALE rather than SPRITE_SCALE.
      this.setDisplayHeight(HERO_HEIGHT * MOTORCYCLE_SPRITE_SCALE);
      this.display.setPosition(HERO_X, this.flyY);
    } else {
      const airborne = this.feetY < floorY - 0.5;
      const kicking = this.isKicking(now);
      riding = !kicking && !this.ducking && !airborne;
      // While kicking, the fire animation (started in kick()) drives the
      // texture frame-by-frame — setting one explicitly here would fight it.
      if (!kicking) {
        this.display.setTexture(
          this.ducking ? Hero.TEX_DUCK : airborne ? Hero.TEX_JUMP : Hero.TEX_MOTORCYCLE_BODY,
        );
      }
      this.display.setOrigin(0.5, 1);
      // The fire frames are full bike+rider illustrations, same aspect
      // family as motorcycle-body.png, so they need the bike's scale too —
      // not SPRITE_SCALE, which is tuned for the human-silhouette poses
      // (duck/jump) and would render the kick noticeably oversized.
      this.setDisplayHeight(
        this.ducking
          ? DUCK_SPRITE_SIZE
          : this.height * (riding || kicking ? MOTORCYCLE_SPRITE_SCALE : SPRITE_SCALE),
      );
      this.display.setPosition(HERO_X, this.feetY);
    }
    this.updateMotorcycleEffects(dt, riding);
    this.display.setAlpha(this.isBlinking(now) ? (Math.sin(now * 40) > 0 ? 0.2 : 0.6) : 1);
  }

  /**
   * Positions the exhaust smoke, wind-streak, and wheel-spinner effects to
   * match the body sprite's current on-screen transform (whatever it
   * currently is — GROUND_TOP, mid-jump landing, a ridden platform —
   * rather than assuming a fixed layout), and stops/hides all of them
   * outside the riding state (ducking, jumping, kicking, flying).
   */
  private updateMotorcycleEffects(dt: number, riding: boolean): void {
    this.frontWheelSpinner.setVisible(riding);
    this.rearWheelSpinner.setVisible(riding);
    if (!riding) {
      this.smokeEmitter.stop();
      this.windEmitter.stop();
      return;
    }
    const bodyW = this.display.displayWidth;
    const bodyH = this.display.displayHeight;
    const originX = this.display.x - bodyW / 2; // origin (0.5, 1): left edge
    const originY = this.display.y - bodyH; // origin (0.5, 1): top edge
    const scale = bodyH / MOTORCYCLE_BODY_TEX_SIZE.height;

    this.wheelSpinAngle += dt * MOTORCYCLE_WHEEL_SPIN_SPEED;
    // Scales the spinner texture so its spike tips (drawn at
    // MOTORCYCLE_SPINNER_TEX_RADIUS within the texture) land exactly on
    // the wheel's true radius on screen.
    const spinnerSize =
      (MOTORCYCLE_WHEEL_RADIUS * MOTORCYCLE_SPINNER_TEX_SIZE * scale) /
      MOTORCYCLE_SPINNER_TEX_RADIUS;
    for (const [spinner, center] of [
      [this.frontWheelSpinner, MOTORCYCLE_FRONT_WHEEL_CENTER],
      [this.rearWheelSpinner, MOTORCYCLE_REAR_WHEEL_CENTER],
    ] as const) {
      spinner.setRotation(this.wheelSpinAngle);
      spinner.setDisplaySize(spinnerSize, spinnerSize);
      spinner.setPosition(originX + center.x * scale, originY + center.y * scale);
    }

    this.smokeEmitter.setPosition(
      originX + MOTORCYCLE_EXHAUST_POSITION.x * scale,
      originY + MOTORCYCLE_EXHAUST_POSITION.y * scale,
    );
    this.smokeEmitter.start();

    this.windEmitter.setPosition(
      originX + MOTORCYCLE_WIND_POSITION.x * scale,
      originY + MOTORCYCLE_WIND_POSITION.y * scale,
    );
    this.windEmitter.start();
  }

  /**
   * Scales the sprite to a fixed HEIGHT while preserving its native aspect
   * ratio (width follows). The five sprite images are cropped tight to their
   * alpha bounds but aren't identically proportioned, so forcing a uniform
   * square box (the original approach) squashed some poses and caused a
   * visible size/position wobble when the run frames alternated.
   */
  private setDisplayHeight(targetHeight: number): void {
    const src = this.display.texture.source[0];
    const aspect = src.width / src.height;
    this.display.setDisplaySize(targetHeight * aspect, targetHeight);
  }
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Exhaust puffs: small grey circles drifting back-left (away from the direction of travel) and fading out. */
function buildSmokeEmitter(scene: Phaser.Scene): Phaser.GameObjects.Particles.ParticleEmitter {
  const textureKey = 'hero-motorcycle-smoke';
  if (!scene.textures.exists(textureKey)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xaaaaaa, 1);
    g.fillCircle(6, 6, 6);
    g.generateTexture(textureKey, 12, 12);
    g.destroy();
  }
  const emitter = scene.add.particles(0, 0, textureKey, {
    lifespan: 500,
    speed: { min: 10, max: 30 },
    angle: { min: 160, max: 200 },
    scale: { start: 0.6, end: 1.8 },
    alpha: { start: 0.5, end: 0 },
    quantity: 1,
    frequency: 90,
    tint: 0x999999,
  });
  emitter.stop();
  return emitter;
}

/**
 * Wind streaks: short white lines rushing back-left past the rider's
 * head/torso, faster than the world scroll (see MOTORCYCLE_WIND_SPEED),
 * to sell the sense of the bike actively cutting through the air rather
 * than sitting still in front of a moving background.
 */
function buildWindEmitter(scene: Phaser.Scene): Phaser.GameObjects.Particles.ParticleEmitter {
  const textureKey = 'hero-motorcycle-wind';
  if (!scene.textures.exists(textureKey)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 26, 2);
    g.generateTexture(textureKey, 26, 2);
    g.destroy();
  }
  const emitter = scene.add.particles(0, 0, textureKey, {
    x: { min: -MOTORCYCLE_WIND_SPREAD.x, max: MOTORCYCLE_WIND_SPREAD.x },
    y: { min: -MOTORCYCLE_WIND_SPREAD.y, max: MOTORCYCLE_WIND_SPREAD.y },
    lifespan: 220,
    speed: MOTORCYCLE_WIND_SPEED,
    angle: { min: 175, max: 185 },
    scale: { min: 0.7, max: 1.3 },
    alpha: { start: 0.45, end: 0 },
    quantity: 1,
    frequency: 45,
    tint: 0xdff2ff,
  });
  emitter.stop();
  return emitter;
}

/**
 * A 6-blade chrome "spinner" drawn from scratch (not extracted from the
 * source photo) so it has no fork/caliper baked into it to conflict with —
 * see the comment above MOTORCYCLE_FRONT_WHEEL_CENTER for why that matters.
 * Semi-transparent so the wheel's own rotor/spoke art still shows through.
 */
function buildWheelSpinnerTexture(scene: Phaser.Scene): string {
  const textureKey = 'hero-motorcycle-spinner';
  if (scene.textures.exists(textureKey)) return textureKey;

  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const size = MOTORCYCLE_SPINNER_TEX_SIZE;
  const center = size / 2;
  const innerR = 30;
  const outerR = MOTORCYCLE_SPINNER_TEX_RADIUS;
  const bladeHalfAngle = 0.07; // radians
  const bladeCount = 6;

  g.fillStyle(0xe8eef2, 0.55);
  for (let i = 0; i < bladeCount; i++) {
    const angle = (i / bladeCount) * Math.PI * 2;
    const tipX = center + Math.cos(angle) * outerR;
    const tipY = center + Math.sin(angle) * outerR;
    const base1X = center + Math.cos(angle - bladeHalfAngle) * innerR;
    const base1Y = center + Math.sin(angle - bladeHalfAngle) * innerR;
    const base2X = center + Math.cos(angle + bladeHalfAngle) * innerR;
    const base2Y = center + Math.sin(angle + bladeHalfAngle) * innerR;
    g.beginPath();
    g.moveTo(tipX, tipY);
    g.lineTo(base1X, base1Y);
    g.lineTo(base2X, base2Y);
    g.closePath();
    g.fillPath();
  }
  g.fillStyle(0xcfd8dc, 0.6);
  g.fillCircle(center, center, innerR * 0.7);

  g.generateTexture(textureKey, size, size);
  g.destroy();
  return textureKey;
}
