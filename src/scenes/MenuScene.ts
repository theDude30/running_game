import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../constants';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    this.add
      .text(GAME_WIDTH / 2, 150, 'RHYTHM RUNNER', {
        fontFamily: 'monospace',
        fontSize: '56px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_WIDTH / 2, 215, 'Local Game · Test Track · 120 BPM (silent metronome)', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#8888aa',
      })
      .setOrigin(0.5);

    const start = this.add
      .text(GAME_WIDTH / 2, 320, 'TAP OR PRESS SPACE TO START', {
        fontFamily: 'monospace',
        fontSize: '26px',
        color: '#4ade80',
      })
      .setOrigin(0.5);
    this.tweens.add({ targets: start, alpha: 0.3, duration: 600, yoyo: true, repeat: -1 });

    this.add
      .text(
        GAME_WIDTH / 2,
        GAME_HEIGHT - 70,
        'JUMP  tap / space / ↑  (twice = double jump)\nDUCK  hold ↓ / left pad      KICK  X / F / right pad',
        {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: '#8888aa',
          align: 'center',
          lineSpacing: 8,
        },
      )
      .setOrigin(0.5);

    const begin = () => this.scene.start('Game');
    this.input.once('pointerdown', begin);
    this.input.keyboard?.once('keydown-SPACE', begin);
    this.input.keyboard?.once('keydown-ENTER', begin);
  }
}
