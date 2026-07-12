import Phaser from 'phaser';
import {
  BLINK_DURATION,
  COLORS,
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
  readonly display: Phaser.GameObjects.Rectangle;
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
    this.display = scene.add.rectangle(
      HERO_X,
      GROUND_TOP - HERO_HEIGHT / 2,
      HERO_WIDTH,
      HERO_HEIGHT,
      COLORS.hero,
    );
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

  get falling(): boolean {
    return this.velY > 60;
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

  /** Enter flying mode with an upward pop from the current stance. */
  enterFlight(): void {
    this.mode = 'flying';
    this.ducking = false;
    this.flyY = this.feetY - HERO_HEIGHT / 2 - 30;
    this.velY = -FLY_ENTRY_SPEED;
    this.thrusting = false;
  }

  /** Return to the ground run (forced landing, whether by timeout or a hit). */
  exitFlight(): void {
    this.mode = 'ground';
    this.feetY = GROUND_TOP;
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

    if (this.mode === 'flying') {
      this.display.setDisplaySize(HERO_WIDTH, HERO_HEIGHT);
      this.display.setPosition(HERO_X, this.flyY);
      this.display.setFillStyle(COLORS.heroFlying);
    } else {
      const h = this.height;
      this.display.setDisplaySize(HERO_WIDTH, h);
      this.display.setPosition(HERO_X, this.feetY - h / 2);
      this.display.setFillStyle(this.isKicking(now) ? COLORS.heroKick : COLORS.hero);
    }
    this.display.setAlpha(this.isBlinking(now) ? (Math.sin(now * 40) > 0 ? 0.2 : 0.6) : 1);
  }
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
