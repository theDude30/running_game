import Phaser from 'phaser';
import {
  COLORS,
  FLY_BAND_HIGH,
  FLY_BAND_LOW,
  FLY_DRAGON_BOB_AMPLITUDE,
  FLY_DRAGON_BOB_SPEED,
  FLY_DRAGON_FLAP_SPEED,
  FLY_DRAGON_WEAVE_AMPLITUDE,
  FLY_DRAGON_WEAVE_SPEED,
  FLY_HITBOX_HEIGHT,
  FLY_MIN_BAND_SWITCH,
  GAME_WIDTH,
  HERO_X,
  SCROLL_SPEED,
} from '../constants';
import type { BeatEvent, ObstacleType } from '../beatmap/types';
import type { Box } from './Hero';

export type Band = 'high' | 'low';

const BAND_Y: Record<Band, number> = { high: FLY_BAND_HIGH, low: FLY_BAND_LOW };
const DRAGON_WIDTH = 62;
const DRAGON_HEIGHT = 52;
// Hitbox-aware, same fairness contract as the ground game's timing windows:
// the hero's edges (not just its center) must clear the danger zone.
const DRAGON_HALF = DRAGON_HEIGHT / 2 + FLY_HITBOX_HEIGHT / 2;

function opposite(band: Band): Band {
  return band === 'high' ? 'low' : 'high';
}

/**
 * Ground obstacle families double as flight triggers: bass-family events
 * (the ones that ask the player to jump) ask the flying player to climb
 * (dragon parked low); mid-family (duck-family) ask them to dive (dragon
 * parked high). Reuses the same beat-aligned, feasibility-checked,
 * rest-carved event stream as the ground game instead of a second pass.
 */
function eventToBand(type: ObstacleType): Band {
  if (type === 'pit' || type === 'hardWall' || type === 'breakableWall') return 'high';
  return 'low';
}

/**
 * Flight-mode obstacle: a bird/dragon parked at the dangerous altitude (the
 * band opposite the safe one). Avoided by simply not being there when it
 * reaches the hero's column — no gap to thread, just a hazard to dodge.
 */
export class FlyingObstacle {
  readonly hitTime: number;
  readonly band: Band;
  cleared = false;
  hitPlayer = false;
  /** Closest the hero got to the safe band center while nearby (for rating). */
  closestDelta = Infinity;

  private readonly container: Phaser.GameObjects.Container;
  private readonly leftWing: Phaser.GameObjects.Rectangle;
  private readonly rightWing: Phaser.GameObjects.Rectangle;
  /** Per-instance phase so a flock of dragons don't bob/flap in lockstep. */
  private readonly phase: number;
  /** Current vertical bob offset, folded into collision so hitbox = visual. */
  private bobY = 0;

  constructor(scene: Phaser.Scene, hitTime: number, band: Band) {
    this.hitTime = hitTime;
    this.band = band;
    this.phase = (hitTime * 2.7) % (Math.PI * 2);

    const cy = BAND_Y[opposite(band)];
    const body = scene.add.rectangle(0, cy, DRAGON_WIDTH * 0.55, DRAGON_HEIGHT, COLORS.flyDragon);
    this.leftWing = scene.add.rectangle(
      -DRAGON_WIDTH * 0.22,
      cy - DRAGON_HEIGHT * 0.32,
      DRAGON_WIDTH * 0.4,
      10,
      COLORS.flyDragon,
    );
    this.rightWing = scene.add.rectangle(
      DRAGON_WIDTH * 0.22,
      cy - DRAGON_HEIGHT * 0.32,
      DRAGON_WIDTH * 0.4,
      10,
      COLORS.flyDragon,
    );
    this.container = scene.add.container(-1000, 0, [body, this.leftWing, this.rightWing]);
    this.container.setVisible(false);
  }

  get done(): boolean {
    return this.cleared || this.hitPlayer;
  }

  get x(): number {
    return this.container.x;
  }

  get width(): number {
    return DRAGON_WIDTH;
  }

  setSongTime(t: number): void {
    // Flying, not static: a gentle bob + horizontal weave on top of the
    // scroll, plus flapping wings. The hitbox tracks both offsets exactly
    // (via the container's actual x/y), so what you see is what hits.
    const baseX = HERO_X + (this.hitTime - t) * SCROLL_SPEED;
    const weaveX = Math.sin(t * FLY_DRAGON_WEAVE_SPEED + this.phase + 1.7) * FLY_DRAGON_WEAVE_AMPLITUDE;
    this.container.x = baseX + weaveX;
    this.container.setVisible(this.container.x > -80 && this.container.x < GAME_WIDTH + 250);

    this.bobY = Math.sin(t * FLY_DRAGON_BOB_SPEED + this.phase) * FLY_DRAGON_BOB_AMPLITUDE;
    this.container.y = this.bobY;
    const flap = Math.sin(t * FLY_DRAGON_FLAP_SPEED + this.phase);
    this.leftWing.rotation = flap * 0.5;
    this.rightWing.rotation = -flap * 0.5;
  }

  /** Collision box: the dragon's own compact body, not a screen-spanning barrier. */
  forbiddenBoxes(): Box[] {
    const halfW = this.width / 2;
    const cy = BAND_Y[opposite(this.band)] + this.bobY;
    return [{ left: this.x - halfW, right: this.x + halfW, top: cy - DRAGON_HALF, bottom: cy + DRAGON_HALF }];
  }

  trackApproach(heroFlyY: number): void {
    const safeCenter = BAND_Y[this.band];
    this.closestDelta = Math.min(this.closestDelta, Math.abs(heroFlyY - safeCenter));
  }

  destroyVisual(): void {
    this.container.destroy();
  }
}

/**
 * No unwinnable sequences: crossing between bands takes real time (the hero
 * only has hold/release control), so two close-together obstacles demanding
 * opposite bands would be unfair. Force the later one to match the earlier
 * one's band whenever the gap is too tight to physically cross — same
 * philosophy as the ground beatmap's feasibility pass.
 */
function planBands(events: BeatEvent[]): { time: number; band: Band }[] {
  const plan = events.map((e) => ({ time: e.time, band: eventToBand(e.type) }));
  for (let i = 1; i < plan.length; i++) {
    if (plan[i].band !== plan[i - 1].band && plan[i].time - plan[i - 1].time < FLY_MIN_BAND_SWITCH) {
      plan[i] = { ...plan[i], band: plan[i - 1].band };
    }
  }
  return plan;
}

export function createFlyingObstacles(scene: Phaser.Scene, events: BeatEvent[]): FlyingObstacle[] {
  return planBands(events).map((p) => new FlyingObstacle(scene, p.time, p.band));
}
