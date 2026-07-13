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
  STOMP_BOUNCE,
} from '../constants';
import runCycle1Url from '../assets/hero/run-cycle-1.png';
import runCycle2Url from '../assets/hero/run-cycle-2.png';
import runCycle3Url from '../assets/hero/run-cycle-3.png';
import runCycle4Url from '../assets/hero/run-cycle-4.png';
import runCycle5Url from '../assets/hero/run-cycle-5.png';
import runCycle6Url from '../assets/hero/run-cycle-6.png';
import runCycle7Url from '../assets/hero/run-cycle-7.png';
import runCycle8Url from '../assets/hero/run-cycle-8.png';
import runCycle9Url from '../assets/hero/run-cycle-9.png';
import runCycle10Url from '../assets/hero/run-cycle-10.png';
import runCycle11Url from '../assets/hero/run-cycle-11.png';
import runCycle12Url from '../assets/hero/run-cycle-12.png';
import duckUrl from '../assets/hero/duck.png';
import jumpUrl from '../assets/hero/jump.png';
import fireUrl from '../assets/hero/fire.png';

const RUN_CYCLE_URLS = [
  runCycle1Url,
  runCycle2Url,
  runCycle3Url,
  runCycle4Url,
  runCycle5Url,
  runCycle6Url,
  runCycle7Url,
  runCycle8Url,
  runCycle9Url,
  runCycle10Url,
  runCycle11Url,
  runCycle12Url,
];

// Sprite art is square and includes flowing hair/guitar that extends well
// beyond the hitbox, so the visual size is scaled up independently of
// HERO_WIDTH/HERO_HEIGHT (which stay pure hitbox dimensions).
const SPRITE_SCALE = 1.9;

// The source video these 12 frames were extracted from played at 6fps (2s
// for a full cycle) — a natural jogging cadence. Locking the full cycle to
// a single beat (0.5s at 120bpm) played it back 4x too fast, so stretch it
// across several beats instead; still scales with song tempo, just at the
// source's original pace rather than one loop per beat.
const RUN_CYCLE_BEATS = 4;

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
  private static readonly TEX_RUN_CYCLE = RUN_CYCLE_URLS.map((_, i) => `hero-run-${i}`);
  private static readonly TEX_DUCK = 'hero-duck';
  private static readonly TEX_JUMP = 'hero-jump';
  private static readonly TEX_FIRE = 'hero-fire';

  static preload(scene: Phaser.Scene): void {
    RUN_CYCLE_URLS.forEach((url, i) => scene.load.image(Hero.TEX_RUN_CYCLE[i], url));
    scene.load.image(Hero.TEX_DUCK, duckUrl);
    scene.load.image(Hero.TEX_JUMP, jumpUrl);
    scene.load.image(Hero.TEX_FIRE, fireUrl);
  }

  readonly display: Phaser.GameObjects.Image;
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
    this.display = scene.add.image(HERO_X, GROUND_TOP, Hero.TEX_RUN_CYCLE[0]).setOrigin(0.5, 1);
    this.display.setDisplaySize(HERO_HEIGHT * SPRITE_SCALE, HERO_HEIGHT * SPRITE_SCALE);
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
  }

  isKicking(now: number): boolean {
    return this.mode === 'ground' && now <= this.kickUntil;
  }

  /** Active kick hitbox in front of the hero, or null when not kicking. */
  kickBox(now: number): Box | null {
    if (!this.isKicking(now)) return null;
    const b = this.bounds;
    return { left: b.right, right: b.right + KICK_RANGE, top: this.feetY - 56, bottom: this.feetY - 6 };
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
   * @param beatDuration Seconds per beat (60 / bpm) — the run-cycle animation
   *   completes one full loop every RUN_CYCLE_BEATS beats, so legs visibly
   *   speed up on faster tracks instead of cycling at a fixed wall-clock rate.
   */
  update(dt: number, now: number, floorY: number = GROUND_TOP, beatDuration: number = 0.5): void {
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

    if (this.mode === 'flying') {
      this.display.setTexture(Hero.TEX_JUMP);
      this.display.setOrigin(0.5, 0.5);
      this.setDisplayHeight(HERO_HEIGHT * SPRITE_SCALE);
      this.display.setPosition(HERO_X, this.flyY);
    } else {
      const airborne = this.feetY < floorY - 0.5;
      const frameCount = Hero.TEX_RUN_CYCLE.length;
      const frameInterval = (beatDuration * RUN_CYCLE_BEATS) / frameCount;
      // `now` (Conductor.songTime) is negative during the pre-song countdown;
      // JS's `%` can return a negative result for a negative dividend, so
      // normalize into [0, frameCount) rather than indexing with it directly.
      const cycleIndex = ((Math.floor(now / frameInterval) % frameCount) + frameCount) % frameCount;
      const runFrame = Hero.TEX_RUN_CYCLE[cycleIndex];
      const texture = this.isKicking(now)
        ? Hero.TEX_FIRE
        : this.ducking
          ? Hero.TEX_DUCK
          : airborne
            ? Hero.TEX_JUMP
            : runFrame;
      this.display.setTexture(texture);
      this.display.setOrigin(0.5, 1);
      this.setDisplayHeight(this.ducking ? DUCK_SPRITE_SIZE : this.height * SPRITE_SCALE);
      this.display.setPosition(HERO_X, this.feetY);
    }
    this.display.setAlpha(this.isBlinking(now) ? (Math.sin(now * 40) > 0 ? 0.2 : 0.6) : 1);
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
