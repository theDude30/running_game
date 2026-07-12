import Phaser from 'phaser';
import {
  BLINK_DURATION,
  COLORS,
  DUCK_HEIGHT,
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

/**
 * The auto-running hero. Horizontal position is fixed (the world scrolls);
 * vertical motion is simple deterministic kinematics — timing precision
 * matters more here than physics-engine features.
 */
export class Hero {
  readonly display: Phaser.GameObjects.Rectangle;
  private velY = 0;
  private jumpsUsed = 0;
  private feetY = GROUND_TOP;
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

  get bounds(): Box {
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
    if (this.jumpsUsed >= 2) return false;
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
    return now <= this.kickUntil;
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

  update(dt: number, now: number): void {
    this.velY += GRAVITY * dt;
    this.feetY += this.velY * dt;
    if (this.feetY >= GROUND_TOP) {
      this.feetY = GROUND_TOP;
      this.velY = 0;
      this.jumpsUsed = 0;
    }

    const h = this.height;
    this.display.setDisplaySize(HERO_WIDTH, h);
    this.display.setPosition(HERO_X, this.feetY - h / 2);
    this.display.setFillStyle(this.isKicking(now) ? COLORS.heroKick : COLORS.hero);
    this.display.setAlpha(this.isBlinking(now) ? (Math.sin(now * 40) > 0 ? 0.2 : 0.6) : 1);
  }
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
