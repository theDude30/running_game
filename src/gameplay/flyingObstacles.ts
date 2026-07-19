import Phaser from 'phaser';
import {
  FLY_BAND_HIGH,
  FLY_BAND_LOW,
  FLY_DRAGON_BOB_AMPLITUDE,
  FLY_DRAGON_BOB_SPEED,
  FLY_DRAGON_WEAVE_AMPLITUDE,
  FLY_DRAGON_WEAVE_SPEED,
  FLY_HITBOX_HEIGHT,
  FLY_MIN_BAND_SWITCH,
  GAME_WIDTH,
  HERO_X,
  SCROLL_SPEED,
} from '../constants';
import type { BeatEvent, ObstacleType } from '../beatmap/types';
import { HERO_ATLAS, type Box } from './Hero';

export type Band = 'high' | 'low';

const BAND_Y: Record<Band, number> = { high: FLY_BAND_HIGH, low: FLY_BAND_LOW };
const DRAGON_WIDTH = 62;
const DRAGON_HEIGHT = 52;
// Hitbox-aware, same fairness contract as the ground game's timing windows:
// the hero's edges (not just its center) must clear the danger zone.
const DRAGON_HALF = DRAGON_HEIGHT / 2 + FLY_HITBOX_HEIGHT / 2;

// Frames 99–108 from the dragon clip: one continuous wing-raise sweep
// (folded to spread), not a closed loop — consecutive frames are ~13-15
// mean-diff apart, but frame 10 back to frame 1 is ~38, nearly 3x any real
// step, since they're the two ends of the sweep, not adjacent poses. Played
// forward-then-back (yoyo) instead of hard-cutting the loop: every step is
// then a genuine consecutive-frame delta, so the flap reads as one down
// stroke + one recovery stroke with no pop at the seam. Native 24fps per
// frame either direction.
const DRAGON_FRAMES = Array.from(
  { length: 10 },
  (_, i) => `dragon-${String(i + 1).padStart(2, '0')}`,
);
const DRAGON_ANIM = 'fly-dragon-anim';
const DRAGON_SWEEP_MS = (10 / 24) * 1000;
const DRAGON_SPRITE_WIDTH = 100;
// The dragon's torso sits lower-left within the art frame (tail sweeps
// up-right), so the sprite is anchored on the body mass, not the art center,
// to line the visual up with the collision box.
const DRAGON_SPRITE_ORIGIN = { x: 0.4, y: 0.6 };

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
  if (type === 'pit' || type === 'hardWall' || type === 'breakableWall' || type === 'lava')
    return 'high';
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
  /** Per-instance phase so a flock of dragons don't bob/flap in lockstep. */
  private readonly phase: number;
  /** Current vertical bob offset, folded into collision so hitbox = visual. */
  private bobY = 0;

  constructor(scene: Phaser.Scene, hitTime: number, band: Band) {
    this.hitTime = hitTime;
    this.band = band;
    this.phase = (hitTime * 2.7) % (Math.PI * 2);

    if (!scene.anims.exists(DRAGON_ANIM)) {
      scene.anims.create({
        key: DRAGON_ANIM,
        frames: DRAGON_FRAMES.map((frame) => ({ key: HERO_ATLAS, frame })),
        duration: DRAGON_SWEEP_MS,
        yoyo: true,
        repeat: -1,
      });
    }
    const cy = BAND_Y[opposite(band)];
    const sprite = scene.add
      .sprite(0, cy, HERO_ATLAS, DRAGON_FRAMES[0])
      .setOrigin(DRAGON_SPRITE_ORIGIN.x, DRAGON_SPRITE_ORIGIN.y);
    const frame = sprite.frame;
    sprite.setDisplaySize(
      DRAGON_SPRITE_WIDTH,
      (DRAGON_SPRITE_WIDTH * frame.realHeight) / frame.realWidth,
    );
    sprite.play(DRAGON_ANIM);
    // Desync the flap the same way the bob/weave are desynced.
    sprite.anims.setProgress(this.phase / (Math.PI * 2));
    this.container = scene.add.container(-1000, 0, [sprite]);
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
    const weaveX =
      Math.sin(t * FLY_DRAGON_WEAVE_SPEED + this.phase + 1.7) * FLY_DRAGON_WEAVE_AMPLITUDE;
    this.container.x = baseX + weaveX;
    this.container.setVisible(this.container.x > -80 && this.container.x < GAME_WIDTH + 250);

    this.bobY = Math.sin(t * FLY_DRAGON_BOB_SPEED + this.phase) * FLY_DRAGON_BOB_AMPLITUDE;
    this.container.y = this.bobY;
    // Wing flapping comes from the sprite animation itself now.
  }

  /** Collision box: the dragon's own compact body, not a screen-spanning barrier. */
  forbiddenBoxes(): Box[] {
    const halfW = this.width / 2;
    const cy = BAND_Y[opposite(this.band)] + this.bobY;
    return [
      {
        left: this.x - halfW,
        right: this.x + halfW,
        top: cy - DRAGON_HALF,
        bottom: cy + DRAGON_HALF,
      },
    ];
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
    if (
      plan[i].band !== plan[i - 1].band &&
      plan[i].time - plan[i - 1].time < FLY_MIN_BAND_SWITCH
    ) {
      plan[i] = { ...plan[i], band: plan[i - 1].band };
    }
  }
  return plan;
}

export function createFlyingObstacles(scene: Phaser.Scene, events: BeatEvent[]): FlyingObstacle[] {
  return planBands(events).map((p) => new FlyingObstacle(scene, p.time, p.band));
}
