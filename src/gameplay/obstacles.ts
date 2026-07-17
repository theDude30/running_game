import Phaser from 'phaser';
import {
  COLORS,
  GAME_WIDTH,
  GRAVITY,
  GROUND_TOP,
  HERO_WIDTH,
  HERO_X,
  JUMP_VELOCITY,
  SCROLL_SPEED,
  STAIR_STEP_HEIGHT,
} from '../constants';
import type { Beatmap, BeatEvent, ObstacleType } from '../beatmap/types';
import { HERO_ATLAS, type Box } from './Hero';

/**
 * Riding a stair step (unlike clearing a normal obstacle) needs the hero's
 * feet already above the step's top the instant it arrives — a jump timed
 * to the beat, like every other obstacle in the game teaches, is otherwise
 * still low on its arc and clips the step instead of landing on it. Delaying
 * a step's physical arrival until the jump's apex — where height is least
 * sensitive to timing — lets an on-the-beat jump land with a wide margin
 * instead of requiring a jump ~0.3s early.
 */
const STAIR_ARRIVAL_DELAY = Math.abs(JUMP_VELOCITY) / GRAVITY; // seconds to reach apex
const STAIR_LEAD_PX = STAIR_ARRIVAL_DELAY * SCROLL_SPEED;

export type HeroAction = 'jump' | 'duck' | 'kick';

interface Part {
  dx: number; // x offset from the obstacle's beat-center
  cy: number; // absolute world y (center)
  w: number;
  h: number;
  color: number;
  /** Alpha-pulses over time (e.g. glowing lava) instead of sitting static. */
  pulse?: boolean;
}

/**
 * A decorative sprite drawn in place of parts[0] on the real ground shape.
 * parts[0] itself stays in the def (as a hidden hitbox/elevated-platform
 * stand-in — see setElevatedPlatform) but this image is what's actually
 * visible while the obstacle sits at floor 0.
 */
interface ImageOverlay {
  key: string;
  frame: string;
  dx: number;
  cy: number;
  displayWidth: number;
  displayHeight: number;
  originX: number;
  originY: number;
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
  image?: ImageOverlay;
}

const BRANCH_WIDTH = 120;
const BRANCH_HEIGHT = 50;

/**
 * The grass-topped wall art (atlas frame 'wall') drawn for every
 * platform-shaped surface: the duck-under branch, stair steps, and the
 * platform every other obstacle becomes while elevated. The art fills the
 * exact collision box — the grass tips ARE the rideable top surface.
 */
function wallOverlay(cy: number): ImageOverlay {
  return {
    key: HERO_ATLAS,
    frame: 'wall',
    dx: 0,
    cy,
    displayWidth: BRANCH_WIDTH,
    displayHeight: BRANCH_HEIGHT,
    originX: 0.5,
    originY: 0.5,
  };
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
    width: BRANCH_WIDTH,
    parts: [{ dx: 0, cy: 395, w: BRANCH_WIDTH, h: BRANCH_HEIGHT, color: COLORS.branch }],
    collide: { dx: 0, cy: 395, w: BRANCH_WIDTH, h: BRANCH_HEIGHT },
    requiredActions: ['duck'],
    image: wallOverlay(395),
  },
  breakableWall: {
    width: 44,
    parts: [{ dx: 0, cy: GROUND_TOP - 70, w: 44, h: 140, color: COLORS.breakableWall }],
    collide: { dx: 0, cy: GROUND_TOP - 70, w: 44, h: 140 },
    requiredActions: ['kick', 'jump'],
    kickable: true,
    // Cracked ancient bricks oozing lava — the deep cracks telegraph
    // kickability (readability rule), in contrast to the sealed steel
    // pillar of hardWall. Slightly larger than the collision box, same
    // forgiving-hitbox convention as the other overlays.
    image: {
      key: HERO_ATLAS,
      frame: 'brick-wall',
      dx: 0,
      cy: GROUND_TOP,
      displayWidth: 48,
      displayHeight: 145,
      originX: 0.5,
      originY: 1,
    },
  },
  hardWall: {
    width: 44,
    parts: [{ dx: 0, cy: GROUND_TOP - 45, w: 44, h: 90, color: COLORS.hardWall }],
    collide: { dx: 0, cy: GROUND_TOP - 45, w: 44, h: 90 },
    requiredActions: ['jump'],
    // Steel pillar wrapped in electrified barbed wire — reads as "can't
    // break this, jump it", in contrast to the cracked breakable wall.
    // Drawn slightly larger than the collision box (barbs/top overhang),
    // same forgiving-hitbox convention as the mummy's outstretched arm.
    image: {
      key: HERO_ATLAS,
      frame: 'steel-wall',
      dx: 0,
      cy: GROUND_TOP,
      displayWidth: 52,
      displayHeight: 100,
      originX: 0.5,
      originY: 1,
    },
  },
  zombie: {
    width: 40,
    // parts[0] is never actually shown at floor 0 (the mummy image below
    // replaces it) — it only stands in as the plain rideable platform shape
    // while elevated, same as every other non-branch hazard (see
    // ELEVATED_PLATFORM_DEF's doc comment) and as storage for baseColor.
    parts: [{ dx: 0, cy: GROUND_TOP - 28, w: 40, h: 56, color: COLORS.zombie }],
    collide: { dx: 0, cy: GROUND_TOP - 28, w: 40, h: 56 },
    requiredActions: ['kick', 'jump'],
    kickable: true,
    stompable: true,
    // Lunging pose: the pointing arm reaches ~60% of the art's width beyond
    // the body itself, so the origin is anchored on the body mass (not the
    // image's own center) to keep that outstretched arm/fist clear of the
    // hitbox, reaching toward the hero instead of sitting inside it.
    image: {
      key: HERO_ATLAS,
      frame: 'mummy',
      dx: 0,
      cy: GROUND_TOP,
      displayWidth: 116,
      displayHeight: 100,
      originX: 0.634,
      originY: 1,
    },
  },
  lava: {
    width: 130,
    parts: [
      { dx: 0, cy: GROUND_TOP + 35, w: 130, h: 70, color: COLORS.lava },
      { dx: -38, cy: GROUND_TOP + 8, w: 16, h: 12, color: COLORS.lavaRock },
      { dx: 36, cy: GROUND_TOP + 6, w: 14, h: 12, color: COLORS.lavaRock },
      { dx: 0, cy: GROUND_TOP + 18, w: 108, h: 12, color: COLORS.lavaGlow, pulse: true },
    ],
    collide: { dx: 0, cy: GROUND_TOP + 10, w: 118, h: 20 },
    requiredActions: ['jump'],
    groundHazard: true,
  },
};

/**
 * What every non-branch obstacle (zombie, pit, hardWall, breakableWall,
 * lava) becomes while elevated: a plain rideable platform, identical in
 * shape to a normal branch. This guarantees the upper floors have exactly
 * as much to land on as the song has obstacles — no ground-anchored hazard
 * floating nonsensically in mid-air, and no beat left with nothing to jump
 * to. Ordinary branches and stair tiers are already fine as they are (type
 * 'branch' already doubles as a platform) so they're left untouched.
 */
const ELEVATED_PLATFORM_DEF: ObstacleDef = {
  width: BRANCH_WIDTH,
  parts: [{ dx: 0, cy: 395, w: BRANCH_WIDTH, h: BRANCH_HEIGHT, color: COLORS.branch }],
  collide: { dx: 0, cy: 395, w: BRANCH_WIDTH, h: BRANCH_HEIGHT },
  requiredActions: ['jump'],
};

/**
 * A staircase step is a 'branch' whose height is derived from its tier
 * instead of DEFS.branch's fixed cy — tier 1 lines up exactly with a normal
 * branch (see STAIR_STEP_HEIGHT's doc comment), each tier above that another
 * STAIR_STEP_HEIGHT higher. Riding tier STAIRS_PER_FLOOR lands the hero
 * exactly at the next floor's ground level.
 */
function stairDef(tier: number): ObstacleDef {
  const cy = GROUND_TOP - tier * STAIR_STEP_HEIGHT + BRANCH_HEIGHT / 2;
  return {
    width: BRANCH_WIDTH,
    parts: [{ dx: 0, cy, w: BRANCH_WIDTH, h: BRANCH_HEIGHT, color: COLORS.branch }],
    collide: { dx: 0, cy, w: BRANCH_WIDTH, h: BRANCH_HEIGHT },
    requiredActions: ['jump'],
    image: wallOverlay(cy),
  };
}

export class Obstacle {
  readonly type: ObstacleType;
  readonly hitTime: number;
  /** The obstacle's active shape — groundDef normally, ELEVATED_PLATFORM_DEF while elevated (see setElevatedPlatform). */
  def: ObstacleDef;
  /** The obstacle's real, permanent shape — what it reverts to back at floor 0. */
  private readonly groundDef: ObstacleDef;
  private elevatedPlatform = false;
  /** Set only for the 3 branch events forming a staircase (1..STAIRS_PER_FLOOR). */
  readonly stairTier?: number;

  /** Best |delta| action timing recorded near this obstacle's beat, or null. */
  actionDelta: number | null = null;
  cleared = false;
  hitPlayer = false;
  destroyed = false;
  /** Passed through while the hero was blink-invincible: no score either way. */
  ghosted = false;
  /** One-shot latch so riding the top step only ever advances the floor once. */
  stairClaimed = false;

  private readonly container: Phaser.GameObjects.Container;
  private readonly rects: Phaser.GameObjects.Rectangle[];
  private readonly pulseParts: Phaser.GameObjects.Rectangle[];
  /** Ground-level art overlay (e.g. the mummy sprite) — see ObstacleDef.image. */
  private readonly image: Phaser.GameObjects.Image | null;
  /** Grass-wall art shown while this obstacle rides as an elevated platform (see setElevatedPlatform). */
  private readonly platformImage: Phaser.GameObjects.Image | null;
  private readonly baseColor: number;
  /**
   * Rhythm rule: at exactly `hitTime` the collision box's leading edge meets
   * the hero's front — acting ON the beat always clears, acting late gets
   * hit. This offset shifts the obstacle so that alignment holds.
   */
  private readonly beatAlign: number;
  /**
   * Stand-in for beatAlign while riding as an elevated platform (see
   * setElevatedPlatform) — adds STAIR_LEAD_PX, same as a stair tier,
   * delaying physical arrival (but not the hitTime used for scoring) until
   * the jump apex, see STAIR_ARRIVAL_DELAY. Ground-floor timing (beatAlign)
   * can't just always include this: it's tuned against this obstacle's own
   * ground-hazard shape, which an elevated platform doesn't use.
   */
  private readonly elevatedBeatAlign: number;

  constructor(scene: Phaser.Scene, event: BeatEvent) {
    this.type = event.type;
    this.hitTime = event.time;
    this.stairTier = event.stairTier;
    this.groundDef = this.stairTier !== undefined ? stairDef(this.stairTier) : DEFS[event.type];
    this.def = this.groundDef;
    this.baseColor = this.groundDef.parts[0].color;
    const c = this.groundDef.collide;
    this.beatAlign =
      HERO_WIDTH / 2 + c.w / 2 - c.dx + 2 + (this.stairTier !== undefined ? STAIR_LEAD_PX : 0);
    const ec = ELEVATED_PLATFORM_DEF.collide;
    this.elevatedBeatAlign = HERO_WIDTH / 2 + ec.w / 2 - ec.dx + 2 + STAIR_LEAD_PX;
    this.rects = this.groundDef.parts.map((p) =>
      scene.add.rectangle(p.dx, p.cy, p.w, p.h, p.color),
    );
    this.pulseParts = this.rects.filter((_, i) => this.groundDef.parts[i].pulse);
    const overlay = this.groundDef.image;
    if (overlay) {
      // The image replaces parts[0] visually at floor 0; parts[0] itself
      // stays hidden until elevated (see setElevatedPlatform).
      this.rects[0].setVisible(false);
      this.image = scene.add
        .image(overlay.dx, overlay.cy, overlay.key, overlay.frame)
        .setOrigin(overlay.originX, overlay.originY)
        .setDisplaySize(overlay.displayWidth, overlay.displayHeight);
    } else {
      this.image = null;
    }
    if (this.type !== 'branch') {
      // Pre-built (hidden) so becoming an elevated platform is a pure
      // visibility flip; branches already show the wall via their overlay.
      const o = wallOverlay(ELEVATED_PLATFORM_DEF.parts[0].cy);
      this.platformImage = scene.add
        .image(o.dx, o.cy, o.key, o.frame)
        .setDisplaySize(o.displayWidth, o.displayHeight)
        .setVisible(false);
    } else {
      this.platformImage = null;
    }
    this.container = scene.add.container(-1000, 0, [
      ...this.rects,
      ...(this.image ? [this.image] : []),
      ...(this.platformImage ? [this.platformImage] : []),
    ]);
    this.container.setVisible(false);
  }

  get done(): boolean {
    return this.cleared || this.destroyed || this.hitPlayer || this.ghosted;
  }

  get x(): number {
    return this.container.x;
  }

  /** Reposition from the conductor clock — the only source of movement. */
  setSongTime(t: number, floorOffsetY = 0): void {
    const align = this.elevatedPlatform ? this.elevatedBeatAlign : this.beatAlign;
    const x = HERO_X + align + (this.hitTime - t) * SCROLL_SPEED;
    this.container.x = x;
    // Once destroyed, explode()'s own tween owns container.y — don't fight it.
    if (!this.destroyed) this.container.y = floorOffsetY;
    this.container.setVisible(x > -150 && x < GAME_WIDTH + 250 && !this.destroyed);
    if (this.pulseParts.length) {
      const alpha = 0.6 + Math.sin(t * 6) * 0.3;
      for (const p of this.pulseParts) p.setAlpha(alpha);
    }
  }

  /**
   * Reshapes every non-branch obstacle into a rideable platform while
   * elevated (see ELEVATED_PLATFORM_DEF), and back to its real shape at
   * floor 0. Branches and stair tiers are already fine either way and are
   * left untouched. No-ops when the state hasn't actually changed.
   */
  setElevatedPlatform(on: boolean): void {
    if (this.type === 'branch' || on === this.elevatedPlatform) return;
    this.elevatedPlatform = on;
    this.def = on ? ELEVATED_PLATFORM_DEF : this.groundDef;
    const p = this.def.parts[0];
    this.rects[0].setSize(p.w, p.h).setPosition(p.dx, p.cy);
    // Extra parts (a wall's crack, lava's rocks/glow) only make sense on the real shape.
    for (let i = 1; i < this.rects.length; i++) this.rects[i].setVisible(!on);
    // While elevated, the grass-wall art IS the platform visual; parts[0]
    // only ever shows at floor 0, and then only when no ground image (the
    // mummy) is covering it.
    this.rects[0].setVisible(!on && !this.groundDef.image);
    this.image?.setVisible(!on);
    this.platformImage?.setVisible(on);
  }

  get collideBox(): Box {
    const c = this.def.collide;
    return {
      left: this.x + c.dx - c.w / 2,
      right: this.x + c.dx + c.w / 2,
      top: c.cy - c.h / 2 + this.container.y,
      bottom: c.cy + c.h / 2 + this.container.y,
    };
  }

  /** Branches (and anything reshaped into one while elevated) double as platforms: their top surface, or null if not rideable. */
  get platformTopY(): number | null {
    if (this.type !== 'branch' && !this.elevatedPlatform) return null;
    const c = this.def.collide;
    return c.cy - c.h / 2 + this.container.y;
  }

  /** Kick/stomp destruction with a quick burst animation. */
  explode(scene: Phaser.Scene): void {
    this.destroyed = true;
    scene.tweens.add({
      targets: this.container,
      alpha: 0,
      scaleY: 0.2,
      y: this.container.y + 30,
      duration: 160,
      onComplete: () => this.container.setVisible(false),
    });
  }

  /** Recolor the primary part for the current floor's theme, or revert with no argument. */
  repaint(color?: number): void {
    this.rects[0].setFillStyle(color ?? this.baseColor);
  }
}

export function createObstacles(scene: Phaser.Scene, beatmap: Beatmap): Obstacle[] {
  return beatmap.events.map((event) => new Obstacle(scene, event));
}
