import Phaser from 'phaser';
import {
  COLORS,
  GAME_HEIGHT,
  GAME_WIDTH,
  GROUND_TOP,
  HERO_X,
  RATING_WINDOW,
} from '../constants';
import { Conductor } from '../audio/Conductor';
import { getAudioContext } from '../audio/sources';
import { testBeatmap } from '../beatmap/testBeatmap';
import type { Beatmap, RunConfig } from '../beatmap/types';
import { Hero, boxesOverlap } from '../gameplay/Hero';
import { Obstacle, createObstacles, type HeroAction } from '../gameplay/obstacles';
import { Scoring } from '../gameplay/Scoring';
import { InputController } from '../input/InputController';

const COUNTDOWN = 5;
const RATING_COLORS: Record<string, string> = {
  perfect: '#facc15',
  good: '#4ade80',
  ok: '#93c5fd',
};

type PlayPhase = 'countdown' | 'playing' | 'finished';

export class GameScene extends Phaser.Scene {
  private conductor!: Conductor;
  private beatmap!: Beatmap;
  private hero!: Hero;
  private obstacles!: Obstacle[];
  private scoring!: Scoring;
  private phase: PlayPhase = 'countdown';

  private scoreText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private countdownText!: Phaser.GameObjects.Text;
  private progressFill!: Phaser.GameObjects.Rectangle;
  private beatDot!: Phaser.GameObjects.Arc;
  private groundFlash!: Phaser.GameObjects.Rectangle;
  private pauseOverlay!: Phaser.GameObjects.Container;
  private lastBeat = -Infinity;
  private lastFrameAt = 0;
  private audioCtx: AudioContext | null = null;
  private audioSource: AudioBufferSourceNode | null = null;

  constructor() {
    super('Game');
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
      this.audioSource.connect(ctx.destination);
      this.conductor = new Conductor(this.beatmap.bpm, () => ctx.currentTime, false);
    } else {
      this.audioCtx = null;
      this.audioSource = null;
      this.conductor = new Conductor(this.beatmap.bpm);
    }

    this.scoring = new Scoring();
    this.phase = 'countdown';
    this.lastBeat = -Infinity;

    // World
    this.add.rectangle(
      GAME_WIDTH / 2,
      GROUND_TOP + (GAME_HEIGHT - GROUND_TOP) / 2,
      GAME_WIDTH,
      GAME_HEIGHT - GROUND_TOP,
      COLORS.ground,
    );
    this.groundFlash = this.add
      .rectangle(GAME_WIDTH / 2, GROUND_TOP + 4, GAME_WIDTH, 8, 0xffffff)
      .setAlpha(0);

    this.obstacles = createObstacles(this, this.beatmap);
    this.hero = new Hero(this);

    // HUD
    this.scoreText = this.add
      .text(20, 16, 'SCORE 0', { fontFamily: 'monospace', fontSize: '24px', color: '#ffffff' })
      .setDepth(100);
    this.comboText = this.add
      .text(GAME_WIDTH - 20, 16, '', { fontFamily: 'monospace', fontSize: '24px', color: '#facc15' })
      .setOrigin(1, 0)
      .setDepth(100);
    this.add
      .rectangle(GAME_WIDTH / 2, 24, 302, 10)
      .setStrokeStyle(1, 0xffffff, 0.4)
      .setDepth(100);
    this.progressFill = this.add
      .rectangle(GAME_WIDTH / 2 - 150, 24, 0, 6, 0x4ade80)
      .setOrigin(0, 0.5)
      .setDepth(100);
    this.beatDot = this.add.circle(GAME_WIDTH / 2, 48, 6, 0x4ade80).setDepth(100);
    this.countdownText = this.add
      .text(GAME_WIDTH / 2, 240, '', { fontFamily: 'monospace', fontSize: '96px', color: '#ffffff' })
      .setOrigin(0.5)
      .setDepth(100);

    // Input
    const input = new InputController(this);
    input.on('jump', () => this.onAction('jump'));
    input.on('duck', (on: boolean) => {
      this.hero.setDuck(on);
      if (on) this.registerActionTiming('duck');
    });
    input.on('kick', () => this.onAction('kick'));

    // Pause
    const pauseBtn = this.add
      .text(GAME_WIDTH - 24, 60, '❚❚', { fontFamily: 'monospace', fontSize: '26px', color: '#8888aa' })
      .setOrigin(1, 0)
      .setDepth(100)
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
      if (this.audioCtx?.state === 'suspended') void this.audioCtx.resume();
    });

    this.lastFrameAt = performance.now() / 1000;
    this.conductor.startIn(COUNTDOWN);
    // Music begins the instant the countdown hits zero
    this.audioSource?.start(this.audioCtx!.currentTime + COUNTDOWN);
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
    this.pauseOverlay = this.add.container(0, 0, [dim, label]).setDepth(200).setVisible(false);
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
    if (this.phase !== 'playing') return;
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

    this.hero.update(dt, t);
    this.pulseOnBeat(t);

    for (const o of this.obstacles) o.setSongTime(t);
    if (this.phase === 'playing') this.resolveObstacles(t);

    this.progressFill.width = 300 * Phaser.Math.Clamp(t / this.beatmap.duration, 0, 1);

    if (this.phase === 'playing' && t >= this.beatmap.duration) {
      this.phase = 'finished';
      this.time.delayedCall(800, () => this.scene.start('Results', this.scoring.stats));
    }
  }

  private pulseOnBeat(t: number): void {
    if (t < 0) return;
    const beat = Math.floor(t / this.conductor.beatDuration);
    if (beat === this.lastBeat) return;
    this.lastBeat = beat;
    this.beatDot.setScale(1.8);
    this.tweens.add({ targets: this.beatDot, scale: 1, duration: 180 });
    this.groundFlash.setAlpha(0.35);
    this.tweens.add({ targets: this.groundFlash, alpha: 0, duration: 160 });
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

      const overlapping = o.def.groundHazard
        ? heroB.bottom >= GROUND_TOP - 2 && heroB.right > box.left && heroB.left < box.right
        : boxesOverlap(heroB, box);
      if (!overlapping) continue;

      // Stomp: falling onto the top of a stompable obstacle
      if (o.def.stompable && this.hero.falling && heroB.bottom <= box.top + 26) {
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

  private awardClear(o: Obstacle, styleBonus = 0): void {
    if (!o.destroyed) o.cleared = true;
    const rating = Scoring.rate(o.actionDelta);
    const points = this.scoring.addClear(rating, styleBonus);
    this.popup(`${rating.toUpperCase()} +${points}`, RATING_COLORS[rating]);
    this.refreshHud();
  }

  private onMiss(t: number): void {
    this.scoring.miss();
    this.hero.startBlink(t);
    this.popup('MISS', '#ef4444');
    this.cameras.main.shake(120, 0.006);
    this.refreshHud();
  }

  private refreshHud(): void {
    this.scoreText.setText(`SCORE ${this.scoring.score}`);
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
