import Phaser from 'phaser';
import {
  COLORS,
  FLY_BAND_HIGH,
  FLY_BAND_LOW,
  FLY_BAND_TOLERANCE,
  FLY_HITBOX_HEIGHT,
  FLY_MIN_BAND_SWITCH,
  FLY_TOP,
  GAME_WIDTH,
  GROUND_TOP,
  HERO_X,
  SCROLL_SPEED,
} from '../constants';
import type { BeatEvent, ObstacleType } from '../beatmap/types';
import type { Box } from './Hero';

export type FlyingKind = 'wall' | 'dragon';
export type Band = 'high' | 'low';

const BAND_Y: Record<Band, number> = { high: FLY_BAND_HIGH, low: FLY_BAND_LOW };
const WALL_WIDTH = 46;
// The gap must fit the hero's hitbox, not just its center: sizing it as
// tolerance + half the hitbox means "stay within `tolerance` of the band
// center" is the whole fairness contract — the hero's edges are covered.
const GAP_HALF = FLY_BAND_TOLERANCE + FLY_HITBOX_HEIGHT / 2;

const DRAGON_WIDTH = 62;
const DRAGON_HEIGHT = 52;
const DRAGON_HALF = DRAGON_HEIGHT / 2 + FLY_HITBOX_HEIGHT / 2; // hitbox-aware, same fairness contract

function opposite(band: Band): Band {
  return band === 'high' ? 'low' : 'high';
}

/**
 * Ground obstacle families double as flight triggers: bass-family events
 * (the ones that ask the player to jump) ask the flying player to climb;
 * mid-family events (duck-family) ask them to dive. Reuses the same
 * beat-aligned, feasibility-checked, rest-carved event stream as the ground
 * game instead of a second analysis pass.
 */
function familyToBand(type: ObstacleType): { kind: FlyingKind; band: Band } {
  if (type === 'pit' || type === 'hardWall' || type === 'breakableWall') {
    return { kind: 'wall', band: 'high' };
  }
  return { kind: 'dragon', band: 'low' };
}

/**
 * Flight-mode obstacle, two flavors:
 *  - 'wall': a barrier spanning the whole flight altitude except a gap
 *    around the safe band — fly through the gap, Flappy-Bird style.
 *  - 'dragon': a compact creature hazard parked at the DANGEROUS band (the
 *    one opposite the safe band) — avoid it by simply being elsewhere,
 *    not by threading a gap.
 */
export class FlyingObstacle {
  readonly hitTime: number;
  readonly kind: FlyingKind;
  readonly band: Band;
  cleared = false;
  hitPlayer = false;
  /** Closest the hero got to the safe band center while nearby (for rating). */
  closestDelta = Infinity;

  private readonly container: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, hitTime: number, kind: FlyingKind, band: Band) {
    this.hitTime = hitTime;
    this.kind = kind;
    this.band = band;

    const parts: Phaser.GameObjects.Rectangle[] =
      kind === 'wall' ? this.buildWallParts(scene) : this.buildDragonParts(scene);
    this.container = scene.add.container(-1000, 0, parts);
    this.container.setVisible(false);
  }

  private buildWallParts(scene: Phaser.Scene): Phaser.GameObjects.Rectangle[] {
    const safeCenter = BAND_Y[this.band];
    const gapTop = safeCenter - GAP_HALF;
    const gapBottom = safeCenter + GAP_HALF;
    const parts: Phaser.GameObjects.Rectangle[] = [];
    if (gapTop > FLY_TOP) {
      const h = gapTop - FLY_TOP;
      parts.push(scene.add.rectangle(0, FLY_TOP + h / 2, WALL_WIDTH, h, COLORS.flyWall));
    }
    if (gapBottom < GROUND_TOP) {
      const h = GROUND_TOP - gapBottom;
      parts.push(scene.add.rectangle(0, gapBottom + h / 2, WALL_WIDTH, h, COLORS.flyWall));
    }
    return parts;
  }

  /** A bird/dragon silhouette: body + two wing slivers, parked at the danger band. */
  private buildDragonParts(scene: Phaser.Scene): Phaser.GameObjects.Rectangle[] {
    const cy = BAND_Y[opposite(this.band)];
    return [
      scene.add.rectangle(0, cy, DRAGON_WIDTH * 0.55, DRAGON_HEIGHT, COLORS.flyDragon),
      scene.add.rectangle(-DRAGON_WIDTH * 0.22, cy - DRAGON_HEIGHT * 0.32, DRAGON_WIDTH * 0.4, 10, COLORS.flyDragon),
      scene.add.rectangle(DRAGON_WIDTH * 0.22, cy - DRAGON_HEIGHT * 0.32, DRAGON_WIDTH * 0.4, 10, COLORS.flyDragon),
    ];
  }

  get done(): boolean {
    return this.cleared || this.hitPlayer;
  }

  get x(): number {
    return this.container.x;
  }

  get width(): number {
    return this.kind === 'wall' ? WALL_WIDTH : DRAGON_WIDTH;
  }

  setSongTime(t: number): void {
    const x = HERO_X + (this.hitTime - t) * SCROLL_SPEED;
    this.container.x = x;
    this.container.setVisible(x > -80 && x < GAME_WIDTH + 250);
  }

  /** Collision box(es): a gap-barrier for walls, a compact body for dragons. */
  forbiddenBoxes(): Box[] {
    const halfW = this.width / 2;
    if (this.kind === 'wall') {
      const safeCenter = BAND_Y[this.band];
      const gapTop = safeCenter - GAP_HALF;
      const gapBottom = safeCenter + GAP_HALF;
      const boxes: Box[] = [];
      if (gapTop > FLY_TOP) {
        boxes.push({ left: this.x - halfW, right: this.x + halfW, top: FLY_TOP, bottom: gapTop });
      }
      if (gapBottom < GROUND_TOP) {
        boxes.push({ left: this.x - halfW, right: this.x + halfW, top: gapBottom, bottom: GROUND_TOP });
      }
      return boxes;
    }
    const cy = BAND_Y[opposite(this.band)];
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
function planBands(events: BeatEvent[]): { time: number; kind: FlyingKind; band: Band }[] {
  const plan = events.map((e) => ({ time: e.time, ...familyToBand(e.type) }));
  for (let i = 1; i < plan.length; i++) {
    if (plan[i].band !== plan[i - 1].band && plan[i].time - plan[i - 1].time < FLY_MIN_BAND_SWITCH) {
      plan[i] = { ...plan[i], band: plan[i - 1].band };
    }
  }
  return plan;
}

export function createFlyingObstacles(scene: Phaser.Scene, events: BeatEvent[]): FlyingObstacle[] {
  return planBands(events).map((p) => new FlyingObstacle(scene, p.time, p.kind, p.band));
}
