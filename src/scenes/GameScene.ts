import Phaser from 'phaser';
import {
  BRANCH_LAND_TOLERANCE,
  COLORS,
  COMBO_TO_FLY,
  FLIGHT_DURATION,
  FLOOR_BONUS,
  FLOOR_CLIMB_PAN_MS,
  FLOOR_FALL_MAX_MS,
  FLOOR_FALL_MIN_MS,
  FLOOR_HEIGHT,
  FLOOR_THEMES,
  FLY_GRACE_PERIOD,
  GAME_HEIGHT,
  GAME_WIDTH,
  GRAVITY,
  GROUND_TOP,
  HERO_WIDTH,
  HERO_X,
  MAX_FLOOR,
  RATING_WINDOW,
  STAIRS_PER_FLOOR,
} from '../constants';
import { Conductor } from '../audio/Conductor';
import { SmoothClock } from '../audio/SmoothClock';
import { WeatherAnalyzer } from '../audio/WeatherAnalyzer';
import { getAudioContext } from '../audio/sources';
import { testBeatmap } from '../beatmap/testBeatmap';
import type { Beatmap, RunConfig } from '../beatmap/types';
import { Hero, boxesOverlap } from '../gameplay/Hero';
import { Obstacle, createObstacles, type HeroAction } from '../gameplay/obstacles';
import { createFlyingObstacles, FlyingObstacle } from '../gameplay/flyingObstacles';
import { Scoring, type Rating } from '../gameplay/Scoring';
import { createStars, Star } from '../gameplay/Star';
import { WeatherSystem } from '../gameplay/WeatherSystem';
import { InputController } from '../input/InputController';

const COUNTDOWN = 5;
/** Grace window (seconds) before bottoming out with no platform actually triggers a fall — see noPlatformSince. */
const NO_PLATFORM_GRACE = 0.2;
const RATING_COLORS: Record<string, string> = {
  perfect: '#facc15',
  good: '#4ade80',
  ok: '#93c5fd',
};

type PlayPhase = 'countdown' | 'playing' | 'finished';
type HeroMode = 'ground' | 'flying';

export class GameScene extends Phaser.Scene {
  private conductor!: Conductor;
  private beatmap!: Beatmap;
  private hero!: Hero;
  private obstacles!: Obstacle[];
  private stars!: Star[];
  private scoring!: Scoring;
  private phase: PlayPhase = 'countdown';
  private heroMode: HeroMode = 'ground';
  private flightEndsAt = 0;
  private flyingObstacles: FlyingObstacle[] = [];
  /** 0 = ground floor. Resets to 0 on any miss/hit; flight fast-travels to highestFloorReached. */
  private currentFloor = 0;
  /** Permanent high-water mark for the run — never decreases, even after falling. */
  private highestFloorReached = 0;
  /** True from fallToGroundFloor() until landOnGroundFloor() — see the `elevated` getter for why this can't just be `currentFloor > 0`. */
  private falling = false;
  /**
   * songTime the hero first bottomed out with no platform underneath, or
   * null if currently on one. Chaining consecutive on-beat jumps across
   * elevated platforms can occasionally produce an unusually high apex
   * (residual momentum from the previous landing), which brings the hero
   * back down to the fallback floor slightly before the next jump's input
   * — see NO_PLATFORM_GRACE. Without this grace window that would end a
   * climb the player was still correctly executing.
   */
  private noPlatformSince: number | null = null;

  private scoreText!: Phaser.GameObjects.Text;
  private starText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private floorText!: Phaser.GameObjects.Text;
  private groundRect!: Phaser.GameObjects.Rectangle;
  private countdownText!: Phaser.GameObjects.Text;
  private progressFill!: Phaser.GameObjects.Rectangle;
  private beatDot!: Phaser.GameObjects.Arc;
  private pauseOverlay!: Phaser.GameObjects.Container;
  private flyBannerText!: Phaser.GameObjects.Text;
  private flyTimerText!: Phaser.GameObjects.Text;
  private lastBeat = -Infinity;
  private lastFrameAt = 0;
  /**
   * Hero's feet position a frame ago, used to detect "descended onto this
   * obstacle" for stomps. Deliberately not based on current velocity: a
   * double-jump input fires in the same frame as landing resets velY to
   * ascending, which would flip a real stomp into a miss if stomp detection
   * looked at instantaneous velocity instead of where the hero just was.
   */
  private prevHeroBottom = GROUND_TOP;
  private audioCtx: AudioContext | null = null;
  private audioSource: AudioBufferSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private weatherAnalyzer: WeatherAnalyzer | null = null;
  private weatherSystem: WeatherSystem | null = null;

  constructor() {
    super('Game');
  }

  preload(): void {
    Hero.preload(this);
  }

  create(): void {
    const config = this.registry.get('runConfig') as RunConfig | undefined;
    this.beatmap = config?.beatmap ?? testBeatmap;

    if (config?.audioBuffer) {
      // Real music: the AudioContext clock IS the game clock.
      const ctx = getAudioContext();
      this.audioCtx = ctx;
      this.audioSource = ctx.createBufferSource();
      this.audioSource.buffer = config.audioBuffer;
      // Analyser is a transparent pass-through — doesn't touch what's heard.
      this.analyserNode = ctx.createAnalyser();
      this.audioSource.connect(this.analyserNode);
      this.analyserNode.connect(ctx.destination);
      const clock = new SmoothClock(ctx);
      this.conductor = new Conductor(this.beatmap.bpm, () => clock.now(), false);
      this.weatherAnalyzer = new WeatherAnalyzer(this.analyserNode, ctx.sampleRate, () => this.conductor.songTime);
      this.weatherSystem = new WeatherSystem(this, this.beatmap.weatherType);
    } else {
      this.audioCtx = null;
      this.audioSource = null;
      this.analyserNode = null;
      this.weatherAnalyzer = null;
      this.weatherSystem = null;
      this.conductor = new Conductor(this.beatmap.bpm);
    }

    this.scoring = new Scoring();
    this.scoring.starsTotal = this.beatmap.stars.length;
    this.phase = 'countdown';
    this.heroMode = 'ground';
    this.flyingObstacles = [];
    this.lastBeat = -Infinity;
    this.currentFloor = 0;
    this.highestFloorReached = 0;
    this.cameras.main.scrollY = 0;

    // World — deliberately left at the default scrollFactor (1), unlike the
    // hero/obstacles/stars which cancel the camera's floor-climb pan. Its
    // height means it naturally scrolls off the bottom of the viewport once
    // the camera pans up for an elevated floor (see FLOOR_HEIGHT vs
    // GAME_HEIGHT), so it needs no explicit hide/show logic — and it's what
    // makes a fall back to floor 0 visually read as the ground rising up to
    // meet the hero as the camera pans back down, instead of a silent cut.
    this.groundRect = this.add.rectangle(
      GAME_WIDTH / 2,
      GROUND_TOP + (GAME_HEIGHT - GROUND_TOP) / 2,
      GAME_WIDTH,
      GAME_HEIGHT - GROUND_TOP,
      COLORS.ground,
    );

    this.obstacles = createObstacles(this, this.beatmap);
    this.stars = createStars(this, this.beatmap.stars);
    this.hero = new Hero(this);

    // HUD — screen-locked (scrollFactor 0) since the camera now pans
    // vertically for floor climbing; world objects (hero, obstacles, stars)
    // deliberately stay at the default scrollFactor 1 so they pan with it.
    this.scoreText = this.add
      .text(20, 16, 'SCORE 0', { fontFamily: 'monospace', fontSize: '24px', color: '#ffffff' })
      .setDepth(100)
      .setScrollFactor(0);
    this.starText = this.add
      .text(20, 44, `★ 0/${this.beatmap.stars.length}`, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#fde68a',
      })
      .setDepth(100)
      .setScrollFactor(0);
    this.floorText = this.add
      .text(20, 68, '', { fontFamily: 'monospace', fontSize: '14px', color: '#93c5fd' })
      .setDepth(100)
      .setScrollFactor(0);
    this.comboText = this.add
      .text(GAME_WIDTH - 20, 16, '', { fontFamily: 'monospace', fontSize: '24px', color: '#facc15' })
      .setOrigin(1, 0)
      .setDepth(100)
      .setScrollFactor(0);
    this.add
      .rectangle(GAME_WIDTH / 2, 24, 302, 10)
      .setStrokeStyle(1, 0xffffff, 0.4)
      .setDepth(100)
      .setScrollFactor(0);
    this.progressFill = this.add
      .rectangle(GAME_WIDTH / 2 - 150, 24, 0, 6, 0x4ade80)
      .setOrigin(0, 0.5)
      .setDepth(100)
      .setScrollFactor(0);
    this.beatDot = this.add.circle(GAME_WIDTH / 2, 48, 6, 0x4ade80).setDepth(100).setScrollFactor(0);
    this.countdownText = this.add
      .text(GAME_WIDTH / 2, 240, '', { fontFamily: 'monospace', fontSize: '96px', color: '#ffffff' })
      .setOrigin(0.5)
      .setDepth(100)
      .setScrollFactor(0);
    this.flyBannerText = this.add
      .text(GAME_WIDTH / 2, 90, '✈ FLYING! hold to climb, release to dive', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#38bdf8',
      })
      .setOrigin(0.5)
      .setDepth(100)
      .setScrollFactor(0)
      .setVisible(false);
    this.flyTimerText = this.add
      .text(GAME_WIDTH / 2, 120, '', { fontFamily: 'monospace', fontSize: '16px', color: '#38bdf8' })
      .setOrigin(0.5)
      .setDepth(100)
      .setScrollFactor(0)
      .setVisible(false);

    // Input
    const input = new InputController(this);
    input.on('jump', () => this.onAction('jump'));
    input.on('thrust', (on: boolean) => {
      if (this.heroMode === 'flying') this.hero.setThrust(on);
    });
    input.on('duck', (on: boolean) => {
      if (this.heroMode === 'flying') return;
      this.hero.setDuck(on);
      if (on) this.registerActionTiming('duck');
    });
    input.on('kick', () => this.onAction('kick'));

    // Pause
    const pauseBtn = this.add
      .text(GAME_WIDTH - 24, 60, '❚❚', { fontFamily: 'monospace', fontSize: '26px', color: '#8888aa' })
      .setOrigin(1, 0)
      .setDepth(100)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    pauseBtn.on('pointerdown', () => this.togglePause());
    input.exclude(GAME_WIDTH - 40, 74, 45);
    this.input.keyboard?.on('keydown-ESC', () => this.togglePause());
    this.buildPauseOverlay();

    // Losing visibility (app switch, screen lock) must pause, not desync
    const onHidden = () => {
      if (!this.conductor.paused && this.phase !== 'finished') this.togglePause();
    };
    this.game.events.on(Phaser.Core.Events.HIDDEN, onHidden);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.HIDDEN, onHidden);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.audioSource) {
        try {
          this.audioSource.stop();
        } catch {
          /* already ended */
        }
        this.audioSource.disconnect();
      }
      this.analyserNode?.disconnect();
      if (this.audioCtx?.state === 'suspended') void this.audioCtx.resume();
    });

    this.lastFrameAt = performance.now() / 1000;
    this.conductor.startIn(COUNTDOWN);
    if (this.audioSource && this.audioCtx) {
      // Start the source early by the hardware output latency so the SOUND
      // (not the sample clock) lands exactly on the countdown's zero — this
      // is what makes obstacles feel aligned with what the player hears.
      const latency =
        (this.audioCtx.baseLatency || 0) +
        ((this.audioCtx as AudioContext & { outputLatency?: number }).outputLatency || 0);
      this.audioSource.start(this.audioCtx.currentTime + Math.max(0.05, COUNTDOWN - latency));
    }
  }

  private buildPauseOverlay(): void {
    const dim = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6);
    const label = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'PAUSED\n\ntap or ESC to resume', {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: '#ffffff',
        align: 'center',
      })
      .setOrigin(0.5);
    this.pauseOverlay = this.add
      .container(0, 0, [dim, label])
      .setDepth(200)
      .setScrollFactor(0)
      .setVisible(false);
  }

  private togglePause(): void {
    if (this.phase === 'finished') return;
    if (this.conductor.paused) {
      void this.audioCtx?.resume();
      this.conductor.resume();
      this.pauseOverlay.setVisible(false);
    } else {
      this.conductor.pause();
      void this.audioCtx?.suspend(); // freezes the audio clock AND the music
      this.pauseOverlay.setVisible(true);
    }
  }

  private onAction(action: 'jump' | 'kick'): void {
    if (this.conductor.paused) {
      this.togglePause();
      return;
    }
    if (this.phase !== 'playing' || this.heroMode === 'flying') return;
    const t = this.conductor.songTime;
    if (action === 'jump') {
      if (this.hero.jump()) this.registerActionTiming('jump');
    } else {
      this.hero.kick(t);
      this.registerActionTiming('kick');
    }
  }

  /** Record how close this action was to the nearest matching obstacle's beat. */
  private registerActionTiming(action: HeroAction): void {
    if (this.phase !== 'playing') return;
    const t = this.conductor.songTime;
    for (const o of this.obstacles) {
      if (o.done || !o.def.requiredActions.includes(action)) continue;
      const delta = t - o.hitTime;
      if (Math.abs(delta) > RATING_WINDOW.ok) continue;
      if (o.actionDelta === null || Math.abs(delta) < Math.abs(o.actionDelta)) {
        o.actionDelta = delta;
      }
    }
  }

  update(_time: number, deltaMs: number): void {
    // Swallow render stalls: if no frame ran for a while, shift the clock so
    // the level resumes exactly where the player last saw it.
    const now = performance.now() / 1000;
    const gap = now - this.lastFrameAt;
    this.lastFrameAt = now;
    if (gap > 0.25 && !this.conductor.paused) {
      this.conductor.compensate(gap - 1 / 60);
    }

    if (this.conductor.paused) return;
    const t = this.conductor.songTime;
    const dt = Math.min(deltaMs / 1000, 0.05);

    if (this.phase === 'countdown') {
      if (t < 0) {
        this.countdownText.setText(String(Math.ceil(-t)));
      } else {
        this.phase = 'playing';
        this.countdownText.setText('GO!');
        this.tweens.add({ targets: this.countdownText, alpha: 0, duration: 500, delay: 300 });
      }
    }

    // Obstacle positions first so this frame's floor/collision checks use current x.
    const floorOffsetY = this.floorOffsetY;
    for (const o of this.obstacles) {
      o.setElevatedPlatform(this.elevated);
      o.setSongTime(t, floorOffsetY);
    }
    for (const o of this.flyingObstacles) o.setSongTime(t);
    for (const s of this.stars) s.setSongTime(t, floorOffsetY);

    const floor = this.computeFloorY();
    this.hero.update(dt, t, floor.y);
    if (floor.platform && floor.platform.stairTier === STAIRS_PER_FLOOR && !floor.platform.stairClaimed) {
      floor.platform.stairClaimed = true;
      this.advanceFloor();
    } else if (
      this.currentFloor > 0 &&
      !floor.platform &&
      this.hero.bounds.bottom >= GROUND_TOP + this.floorOffsetY - 1
    ) {
      // Ran out of platform while elevated — there's no visible floor up
      // here to rest on, so bottoming out where the ground WOULD be means
      // falling, same as a miss, just without the score penalty (climbing
      // is a bonus; see FLOOR_BONUS/STAIRS_PER_FLOOR doc comment). Graced
      // briefly — see noPlatformSince — so it's an actual fall, not the
      // tail end of a jump the player was still correctly chaining.
      this.noPlatformSince ??= t;
      if (t - this.noPlatformSince >= NO_PLATFORM_GRACE) this.fallToGroundFloor();
    } else {
      this.noPlatformSince = null;
    }
    this.pulseOnBeat(t);

    if (this.weatherAnalyzer && this.weatherSystem) {
      this.weatherSystem.update(this.weatherAnalyzer.sample());
    }

    if (this.phase === 'playing') {
      if (this.heroMode === 'ground') {
        this.resolveObstacles(t);
        this.resolveStars();
      } else {
        this.resolveFlyingObstacles(t);
        this.flyTimerText.setText(`${Math.max(0, this.flightEndsAt - t).toFixed(1)}s`);
        if (this.hero.touchingGround) {
          this.exitFlight(t, true);
        } else if (t >= this.flightEndsAt) {
          this.exitFlight(t, false);
        }
      }
    }

    this.prevHeroBottom = this.hero.bounds.bottom;

    this.progressFill.width = 300 * Phaser.Math.Clamp(t / this.beatmap.duration, 0, 1);

    if (this.phase === 'playing' && t >= this.beatmap.duration) {
      this.phase = 'finished';
      this.time.delayedCall(800, () => this.scene.start('Results', this.scoring.stats));
    }
  }

  /** The camera's current vertical pan — 0 at the ground floor, more negative per floor climbed. */
  private get floorOffsetY(): number {
    return this.cameras.main.scrollY;
  }

  /**
   * Whether obstacles should render/behave as elevated platforms (see
   * Obstacle.setElevatedPlatform). NOT the same as `currentFloor > 0` —
   * currentFloor resets to 0 synchronously the instant a fall starts, but
   * the ground doesn't visually arrive until the (400-1200ms) fall
   * animation finishes. Without the `falling` half of this, an obstacle
   * could snap back to its real (ground-anchored) shape mid-fall, before
   * the ground it belongs to has even scrolled back into view.
   */
  private get elevated(): boolean {
    return this.currentFloor > 0 || this.falling;
  }

  /**
   * Branches (and staircase steps) double as platforms: ride the top if
   * already above it, else duck under. Also reports which obstacle the
   * hero is riding, if any, so the caller can detect a completed staircase.
   */
  private computeFloorY(): { y: number; platform: Obstacle | null } {
    if (this.heroMode !== 'ground') return { y: GROUND_TOP, platform: null };
    const heroBottom = this.hero.bounds.bottom;
    for (const o of this.obstacles) {
      if (o.done) continue;
      const topY = o.platformTopY;
      if (topY === null) continue;
      // Match the actual collision window (boxesOverlap effectively extends
      // by half the hero's own width too), not just the obstacle's own
      // width — otherwise there's a dead zone at the edges where a hit can
      // still register even though this check no longer considers the hero
      // "landable", which a double jump's altered descent timing can expose.
      const halfW = o.def.width / 2 + HERO_WIDTH / 2;
      if (Math.abs(o.x - HERO_X) <= halfW && heroBottom <= topY + BRANCH_LAND_TOLERANCE) {
        return { y: topY, platform: o };
      }
    }
    return { y: GROUND_TOP + this.floorOffsetY, platform: null };
  }

  private pulseOnBeat(t: number): void {
    if (t < 0) return;
    const beat = Math.floor(t / this.conductor.beatDuration);
    if (beat === this.lastBeat) return;
    this.lastBeat = beat;
    this.beatDot.setScale(1.8);
    this.tweens.add({ targets: this.beatDot, scale: 1, duration: 180 });
  }

  private resolveObstacles(t: number): void {
    const heroB = this.hero.bounds;
    const kickBox = this.hero.kickBox(t);

    for (const o of this.obstacles) {
      if (o.done) continue;
      const box = o.collideBox;

      // Passed behind the hero unharmed → cleared
      if (o.x + o.def.width / 2 < heroB.left - 4) {
        this.awardClear(o);
        continue;
      }

      // Kick destroys kickable obstacles
      if (kickBox && o.def.kickable && boxesOverlap(kickBox, box)) {
        o.explode(this);
        this.awardClear(o, 50);
        continue;
      }

      // groundHazard obstacles (pits, lava) only threaten a hero standing on
      // THIS floor's ground — floor-aware, not the raw base-floor constant,
      // or they'd wrongly stop hitting once the hero climbs a floor.
      const overlapping = o.def.groundHazard
        ? heroB.bottom >= GROUND_TOP + this.floorOffsetY - 2 && heroB.right > box.left && heroB.left < box.right
        : boxesOverlap(heroB, box);
      if (!overlapping) continue;

      // Stomp: hero's feet were above this obstacle's top a moment ago and
      // are now within stomp range — position history, not instantaneous
      // velocity (see prevHeroBottom for why).
      if (o.def.stompable && this.prevHeroBottom <= box.top + 4 && heroB.bottom <= box.top + 26) {
        o.explode(this);
        this.hero.bounce();
        this.awardClear(o);
        continue;
      }

      if (this.hero.isBlinking(t)) {
        o.ghosted = true;
        continue;
      }

      o.hitPlayer = true;
      this.onMiss(t);
    }
  }

  /** Bonus collectibles: simple overlap, no timing judgement, no penalty for missing. */
  private resolveStars(): void {
    const heroB = this.hero.bounds;
    for (const s of this.stars) {
      if (s.done) continue;
      if (s.x + s.width / 2 < heroB.left - 4) {
        s.missed = true;
        continue;
      }
      if (boxesOverlap(heroB, s.bounds)) {
        const points = this.scoring.collectStar(s.points);
        s.collect(this);
        this.popup(`★ +${points}`, '#fde68a');
        this.refreshHud();
      }
    }
  }

  private resolveFlyingObstacles(t: number): void {
    const heroB = this.hero.bounds;
    const heroY = this.hero.flyAltitude;

    for (const o of this.flyingObstacles) {
      if (o.done) continue;

      if (o.x + o.width / 2 < heroB.left - 4) {
        this.awardFlyingClear(o);
        continue;
      }

      if (Math.abs(o.x - HERO_X) < 200) o.trackApproach(heroY);

      if (this.hero.isBlinking(t)) continue;
      if (o.forbiddenBoxes().some((box) => boxesOverlap(heroB, box))) {
        o.hitPlayer = true;
        this.exitFlight(t, true);
        return;
      }
    }
  }

  private awardClear(o: Obstacle, styleBonus = 0): void {
    if (!o.destroyed) o.cleared = true;
    const rating = Scoring.rate(o.actionDelta);
    this.commitClear(rating, styleBonus);
  }

  private awardFlyingClear(o: FlyingObstacle): void {
    o.cleared = true;
    const d = o.closestDelta;
    const rating: Rating = d <= 25 ? 'perfect' : d <= 55 ? 'good' : 'ok';
    this.commitClear(rating);
  }

  /** Shared clear bookkeeping (score/combo/HUD/popup) for ground and flight obstacles. */
  private commitClear(rating: Rating, styleBonus = 0): void {
    const points = this.scoring.addClear(rating, styleBonus);
    this.popup(`${rating.toUpperCase()} +${points}`, RATING_COLORS[rating]);
    this.refreshHud();

    if (
      this.heroMode === 'ground' &&
      this.phase === 'playing' &&
      this.scoring.combo > 0 &&
      this.scoring.combo % COMBO_TO_FLY === 0
    ) {
      this.enterFlight();
    }
  }

  private onMiss(t: number): void {
    this.scoring.miss();
    this.hero.startBlink(t);
    this.fallToGroundFloor();
    this.popup('MISS', '#ef4444');
    this.cameras.main.shake(120, 0.006);
    this.refreshHud();
  }

  private enterFlight(): void {
    const t = this.conductor.songTime;
    this.heroMode = 'flying';
    this.flightEndsAt = t + FLIGHT_DURATION;
    this.hero.enterFlight();

    // Flight always plays out in one fixed altitude band regardless of
    // floor — pan back to neutral so that band lines up with the screen.
    if (this.currentFloor !== 0) {
      this.currentFloor = 0;
      this.panCameraToFloor(0, FLOOR_CLIMB_PAN_MS);
      this.repaintForFloor(0);
    }

    const windowEvents = this.beatmap.events.filter(
      (e) => e.time > t + FLY_GRACE_PERIOD && e.time < this.flightEndsAt,
    );
    this.flyingObstacles = createFlyingObstacles(this, windowEvents);

    this.flyBannerText.setAlpha(1).setVisible(true);
    this.tweens.add({ targets: this.flyBannerText, alpha: 0, duration: 600, delay: 1400 });
    this.flyTimerText.setVisible(true);
  }

  private exitFlight(t: number, failed: boolean): void {
    // Miss feedback (popup, blink, shake) must fire BEFORE the hero resets
    // to ground position — otherwise the "MISS" popup renders down at
    // ground level instead of up where the collision actually happened,
    // reading as if nothing was detected at all.
    if (failed) this.onMiss(t);

    // A clean landing fast-travels to the highest floor reached this run —
    // "skip floor and land on the last one." A failed flight already fell
    // to the ground floor via onMiss()'s fallToGroundFloor().
    const targetFloor = failed ? 0 : this.highestFloorReached;

    this.heroMode = 'ground';
    this.hero.exitFlight(GROUND_TOP - targetFloor * FLOOR_HEIGHT);
    if (targetFloor !== this.currentFloor) {
      this.currentFloor = targetFloor;
      this.panCameraToFloor(targetFloor, FLOOR_CLIMB_PAN_MS);
      this.repaintForFloor(targetFloor);
    }
    this.flyBannerText.setVisible(false);
    this.flyTimerText.setVisible(false);

    // Destroy every flying obstacle, including the one that just caused a
    // hit — it's still "done", but its visual must not freeze on screen.
    for (const o of this.flyingObstacles) o.destroyVisual();
    this.flyingObstacles = [];

    // Ground obstacles that scrolled by underneath while airborne: consume
    // silently (no score either way) so landing doesn't trigger a score burst.
    for (const o of this.obstacles) {
      if (!o.done && o.hitTime <= t) o.ghosted = true;
    }
  }

  /** Riding a staircase's top step climbs to the next floor, capped at MAX_FLOOR. */
  private advanceFloor(): void {
    const newFloor = Math.min(this.currentFloor + 1, MAX_FLOOR);
    if (newFloor === this.currentFloor) return;

    if (newFloor > this.highestFloorReached) {
      this.highestFloorReached = newFloor;
      const bonus = FLOOR_BONUS[newFloor - 1] ?? 0;
      this.scoring.addFloorBonus(bonus);
      this.popup(`FLOOR ${newFloor}! +${bonus}`, '#38bdf8');
      this.refreshHud();
    }

    this.currentFloor = newFloor;
    this.panCameraToFloor(newFloor, FLOOR_CLIMB_PAN_MS);
    this.repaintForFloor(newFloor);
  }

  /**
   * Any miss/hit while elevated drops the hero all the way back to the
   * ground floor. The camera pans down with a gravity-matched ease while
   * the hero's own ground physics (see Hero.update's floorY clamp) keeps
   * pace with it each frame, so the two together read as a real fall
   * through the floors rather than a plain camera move. Repainting for
   * floor 0 immediately (not waiting for the pan to finish) is what makes
   * the ground rect — normally scrolled off the bottom of the screen while
   * elevated, see its comment in create() — visibly rise back into view as
   * the camera descends, instead of the fall being a silent camera move
   * that only reveals anything once it's over.
   */
  private fallToGroundFloor(): void {
    if (this.currentFloor === 0) return;
    const fallDistance = this.currentFloor * FLOOR_HEIGHT;
    const duration = Phaser.Math.Clamp(
      Math.sqrt((2 * fallDistance) / GRAVITY) * 1000,
      FLOOR_FALL_MIN_MS,
      FLOOR_FALL_MAX_MS,
    );
    this.currentFloor = 0;
    this.falling = true;
    // A climb-then-immediate-miss can start this while a climb pan is still
    // running — cancel it first so the two don't fight over scrollY.
    this.tweens.killTweensOf(this.cameras.main);
    this.tweens.add({
      targets: this.cameras.main,
      scrollY: 0,
      duration,
      ease: 'Quad.easeIn',
      onComplete: () => this.landOnGroundFloor(),
    });
    this.repaintForFloor(0);
  }

  /** Impact moment at the end of a fall: a heavier shake than the initial miss, plus a clear callout. */
  private landOnGroundFloor(): void {
    this.falling = false;
    this.cameras.main.shake(200, 0.014);
    this.popup('FELL TO GROUND FLOOR', '#ef4444');
  }

  private panCameraToFloor(floor: number, durationMs: number): void {
    this.tweens.killTweensOf(this.cameras.main);
    this.tweens.add({
      targets: this.cameras.main,
      scrollY: -floor * FLOOR_HEIGHT,
      duration: durationMs,
      ease: 'Sine.easeInOut',
    });
  }

  /** Recolors the ground and every obstacle's primary part for this floor's theme (staircases stay branch-brown). */
  private repaintForFloor(floor: number): void {
    const theme = floor > 0 ? FLOOR_THEMES[floor - 1] : null;
    this.groundRect.setFillStyle(theme?.bg ?? COLORS.ground);
    for (const o of this.obstacles) {
      if (o.stairTier !== undefined) continue;
      o.repaint(theme?.obstacle);
    }
    this.floorText.setText(floor > 0 ? `FLOOR ${floor}` : '');
  }

  private refreshHud(): void {
    this.scoreText.setText(`SCORE ${this.scoring.score}`);
    this.starText.setText(`★ ${this.scoring.starsCollected}/${this.scoring.starsTotal}`);
    const m = this.scoring.multiplier;
    this.comboText.setText(
      this.scoring.combo > 0 ? `×${m}  ${this.scoring.combo} combo` : '',
    );
  }

  private popup(text: string, color: string): void {
    const label = this.add
      .text(HERO_X + 60, this.hero.bounds.top - 24, text, {
        fontFamily: 'monospace',
        fontSize: '22px',
        color,
      })
      .setOrigin(0, 1)
      .setDepth(100);
    this.tweens.add({
      targets: label,
      y: label.y - 46,
      alpha: 0,
      duration: 550,
      onComplete: () => label.destroy(),
    });
  }
}
