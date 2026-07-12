import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../constants';
import type { RunStats } from '../gameplay/Scoring';

export class ResultsScene extends Phaser.Scene {
  constructor() {
    super('Results');
  }

  create(data: RunStats): void {
    const { score, maxCombo, counts } = data;

    this.add
      .text(GAME_WIDTH / 2, 100, 'TRACK COMPLETE', {
        fontFamily: 'monospace',
        fontSize: '40px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_WIDTH / 2, 190, `SCORE  ${score}`, {
        fontFamily: 'monospace',
        fontSize: '48px',
        color: '#4ade80',
      })
      .setOrigin(0.5);

    this.add
      .text(
        GAME_WIDTH / 2,
        290,
        `Max combo  ${maxCombo}\n\nPerfect ${counts.perfect}   Good ${counts.good}   OK ${counts.ok}   Miss ${counts.miss}`,
        {
          fontFamily: 'monospace',
          fontSize: '20px',
          color: '#aaaacc',
          align: 'center',
          lineSpacing: 6,
        },
      )
      .setOrigin(0.5);

    const again = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 110, 'TAP OR PRESS SPACE TO PLAY AGAIN', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#4ade80',
      })
      .setOrigin(0.5);
    this.tweens.add({ targets: again, alpha: 0.3, duration: 600, yoyo: true, repeat: -1 });

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 65, 'M — change music', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#8888aa',
      })
      .setOrigin(0.5);

    this.input.once('pointerdown', () => this.scene.start('Game'));
    this.input.keyboard?.once('keydown-SPACE', () => this.scene.start('Game'));
    this.input.keyboard?.once('keydown-M', () => this.scene.start('SongSelect'));
  }
}
