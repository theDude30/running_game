import Phaser from 'phaser';
import { GAME_WIDTH, GROUND_TOP, HERO_X, SCROLL_SPEED } from '../constants';
import type { StarEvent, StarTier } from '../beatmap/types';
import type { Box } from './Hero';

/**
 * A bonus collectible, deliberately NOT part of the obstacle rhythm system:
 * no button press to time, just spatial positioning. Height alone creates
 * the difficulty tiers — easy sits at body height (collected just by
 * running through), medium needs a timed single jump, hard needs a timed
 * double jump — so "hard to get" falls out of the same jump physics the
 * ground obstacles already use, no separate mechanic required.
 */
const TIER_Y: Record<StarTier, number> = {
  easy: GROUND_TOP - 30,
  medium: GROUND_TOP - 130,
  hard: GROUND_TOP - 195,
};
const TIER_RADIUS: Record<StarTier, number> = { easy: 11, medium: 13, hard: 15 };
const TIER_POINTS: Record<StarTier, number> = { easy: 100, medium: 250, hard: 500 };
const TIER_COLOR: Record<StarTier, number> = { easy: 0xfde68a, medium: 0xfacc15, hard: 0xf59e0b };
const SPIN_SPEED = 1.4; // rad/sec

export class Star {
  readonly time: number;
  readonly tier: StarTier;
  readonly points: number;
  collected = false;
  missed = false;

  private readonly container: Phaser.GameObjects.Container;
  private readonly radius: number;
  private readonly phase: number;
  private currentY: number;

  constructor(scene: Phaser.Scene, event: StarEvent) {
    this.time = event.time;
    this.tier = event.tier;
    this.points = TIER_POINTS[event.tier];
    this.radius = TIER_RADIUS[event.tier];
    this.phase = (event.time * 3.3) % (Math.PI * 2);

    const key = `star-${event.tier}`;
    if (!scene.textures.exists(key)) {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(TIER_COLOR[event.tier], 1);
      g.fillPoints(starPoints(this.radius), true);
      g.generateTexture(key, this.radius * 2, this.radius * 2);
      g.destroy();
    }
    const sprite = scene.add.image(0, 0, key);
    this.currentY = TIER_Y[event.tier];
    this.container = scene.add.container(-1000, this.currentY, [sprite]).setDepth(45);
    this.container.setVisible(false);
  }

  get done(): boolean {
    return this.collected || this.missed;
  }

  get x(): number {
    return this.container.x;
  }

  get width(): number {
    return this.radius * 2;
  }

  setSongTime(t: number, floorOffsetY = 0): void {
    const x = HERO_X + (this.time - t) * SCROLL_SPEED;
    this.container.x = x;
    this.currentY = TIER_Y[this.tier] + floorOffsetY;
    this.container.y = this.currentY;
    this.container.setVisible(x > -60 && x < GAME_WIDTH + 200);
    this.container.rotation = t * SPIN_SPEED + this.phase;
  }

  get bounds(): Box {
    return {
      left: this.x - this.radius,
      right: this.x + this.radius,
      top: this.currentY - this.radius,
      bottom: this.currentY + this.radius,
    };
  }

  /** Sparkle-and-fade pickup animation. */
  collect(scene: Phaser.Scene): void {
    this.collected = true;
    scene.tweens.add({
      targets: this.container,
      alpha: 0,
      scale: 1.7,
      duration: 220,
      onComplete: () => this.container.setVisible(false),
    });
  }
}

function starPoints(r: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    pts.push({ x: r + radius * Math.cos(angle), y: r + radius * Math.sin(angle) });
  }
  return pts;
}

export function createStars(scene: Phaser.Scene, stars: StarEvent[]): Star[] {
  return stars.map((s) => new Star(scene, s));
}
