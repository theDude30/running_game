import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../main';

/**
 * Phase 0 smoke-test scene: proves rendering, scaling, input and the update
 * loop work on every target platform (web, iOS, Android). Replaced by the
 * real Menu/Game scenes in Phase 1.
 */
export class BootScene extends Phaser.Scene {
  private hero!: Phaser.GameObjects.Rectangle;
  private ground!: Phaser.GameObjects.Rectangle;
  private heroVelocityY = 0;
  private jumpsUsed = 0;

  constructor() {
    super('Boot');
  }

  create(): void {
    const groundY = GAME_HEIGHT - 80;

    this.ground = this.add.rectangle(GAME_WIDTH / 2, groundY + 40, GAME_WIDTH, 80, 0x2d2d44);
    this.hero = this.add.rectangle(160, groundY - 32, 48, 64, 0x4ade80);

    this.add
      .text(GAME_WIDTH / 2, 120, 'RHYTHM RUNNER', {
        fontFamily: 'monospace',
        fontSize: '48px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_WIDTH / 2, 180, 'Phase 0 — tap / click / space to jump', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#8888aa',
      })
      .setOrigin(0.5);

    this.input.on('pointerdown', () => this.jump());
    this.input.keyboard?.on('keydown-SPACE', () => this.jump());
  }

  private jump(): void {
    if (this.jumpsUsed >= 2) return; // double jump max
    this.jumpsUsed += 1;
    this.heroVelocityY = -900;
  }

  update(_time: number, deltaMs: number): void {
    const dt = deltaMs / 1000;
    const groundTop = this.ground.y - 40;

    this.heroVelocityY += 2000 * dt;
    this.hero.y += this.heroVelocityY * dt;

    const floorY = groundTop - this.hero.height / 2;
    if (this.hero.y >= floorY) {
      this.hero.y = floorY;
      this.heroVelocityY = 0;
      this.jumpsUsed = 0;
    }
  }
}
