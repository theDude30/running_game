import Phaser from 'phaser';
import { COLORS, GAME_WIDTH, GROUND_TOP, HERO_WIDTH, HERO_X, SCROLL_SPEED } from '../constants';
import type { Beatmap, BeatEvent, ObstacleType } from '../beatmap/types';
import type { Box } from './Hero';

export type HeroAction = 'jump' | 'duck' | 'kick';

interface Part {
  dx: number; // x offset from the obstacle's beat-center
  cy: number; // absolute world y (center)
  w: number;
  h: number;
  color: number;
}

interface ObstacleDef {
  width: number;
  parts: Part[];
  /** Collision box relative to beat-center x; absolute y. */
  collide: { dx: number; cy: number; w: number; h: number };
  /** Actions whose timing is judged against this obstacle's beat. */
  requiredActions: HeroAction[];
  kickable?: boolean;
  stompable?: boolean;
  /** Pit-style hazard: only dangerous while the hero is on the ground. */
  groundHazard?: boolean;
}

const DEFS: Record<ObstacleType, ObstacleDef> = {
  pit: {
    width: 90,
    parts: [{ dx: 0, cy: GROUND_TOP + 40, w: 90, h: 80, color: COLORS.pit }],
    collide: { dx: 0, cy: GROUND_TOP + 10, w: 78, h: 20 },
    requiredActions: ['jump'],
    groundHazard: true,
  },
  branch: {
    width: 120,
    parts: [{ dx: 0, cy: 395, w: 120, h: 50, color: COLORS.branch }],
    collide: { dx: 0, cy: 395, w: 120, h: 50 },
    requiredActions: ['duck'],
  },
  breakableWall: {
    width: 44,
    parts: [
      { dx: 0, cy: GROUND_TOP - 70, w: 44, h: 140, color: COLORS.breakableWall },
      // visible "crack" telegraphs kickability (readability rule)
      { dx: 0, cy: GROUND_TOP - 70, w: 8, h: 124, color: COLORS.crack },
    ],
    collide: { dx: 0, cy: GROUND_TOP - 70, w: 44, h: 140 },
    requiredActions: ['kick', 'jump'],
    kickable: true,
  },
  hardWall: {
    width: 44,
    parts: [{ dx: 0, cy: GROUND_TOP - 45, w: 44, h: 90, color: COLORS.hardWall }],
    collide: { dx: 0, cy: GROUND_TOP - 45, w: 44, h: 90 },
    requiredActions: ['jump'],
  },
  zombie: {
    width: 40,
    parts: [
      { dx: 0, cy: GROUND_TOP - 28, w: 40, h: 56, color: COLORS.zombie },
      { dx: 8, cy: GROUND_TOP - 46, w: 14, h: 6, color: COLORS.zombieEyes },
    ],
    collide: { dx: 0, cy: GROUND_TOP - 28, w: 40, h: 56 },
    requiredActions: ['kick', 'jump'],
    kickable: true,
    stompable: true,
  },
};

export class Obstacle {
  readonly type: ObstacleType;
  readonly hitTime: number;
  readonly def: ObstacleDef;

  /** Best |delta| action timing recorded near this obstacle's beat, or null. */
  actionDelta: number | null = null;
  cleared = false;
  hitPlayer = false;
  destroyed = false;
  /** Passed through while the hero was blink-invincible: no score either way. */
  ghosted = false;

  private readonly container: Phaser.GameObjects.Container;
  /**
   * Rhythm rule: at exactly `hitTime` the collision box's leading edge meets
   * the hero's front — acting ON the beat always clears, acting late gets
   * hit. This offset shifts the obstacle so that alignment holds.
   */
  private readonly beatAlign: number;

  constructor(scene: Phaser.Scene, event: BeatEvent) {
    this.type = event.type;
    this.hitTime = event.time;
    this.def = DEFS[event.type];
    const c = this.def.collide;
    this.beatAlign = HERO_WIDTH / 2 + c.w / 2 - c.dx + 2;
    const rects = this.def.parts.map((p) =>
      scene.add.rectangle(p.dx, p.cy, p.w, p.h, p.color),
    );
    this.container = scene.add.container(-1000, 0, rects);
    this.container.setVisible(false);
  }

  get done(): boolean {
    return this.cleared || this.destroyed || this.hitPlayer || this.ghosted;
  }

  get x(): number {
    return this.container.x;
  }

  /** Reposition from the conductor clock — the only source of movement. */
  setSongTime(t: number): void {
    const x = HERO_X + this.beatAlign + (this.hitTime - t) * SCROLL_SPEED;
    this.container.x = x;
    this.container.setVisible(x > -150 && x < GAME_WIDTH + 250 && !this.destroyed);
  }

  get collideBox(): Box {
    const c = this.def.collide;
    return {
      left: this.x + c.dx - c.w / 2,
      right: this.x + c.dx + c.w / 2,
      top: c.cy - c.h / 2,
      bottom: c.cy + c.h / 2,
    };
  }

  /** Kick/stomp destruction with a quick burst animation. */
  explode(scene: Phaser.Scene): void {
    this.destroyed = true;
    scene.tweens.add({
      targets: this.container,
      alpha: 0,
      scaleY: 0.2,
      y: 30,
      duration: 160,
      onComplete: () => this.container.setVisible(false),
    });
  }
}

export function createObstacles(scene: Phaser.Scene, beatmap: Beatmap): Obstacle[] {
  return beatmap.events.map((event) => new Obstacle(scene, event));
}
