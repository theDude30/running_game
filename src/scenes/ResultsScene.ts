import Phaser from 'phaser';
import { DPR, GAME_HEIGHT, GAME_WIDTH } from '../constants';
import type { RunStats } from '../gameplay/Scoring';

export class ResultsScene extends Phaser.Scene {
  constructor() {
    super('Results');
  }

  create(data: RunStats): void {
    // High-DPI: zoom from the top-left so coordinates stay 960×540 (see DPR).
    this.cameras.main.setOrigin(0, 0).setZoom(DPR);
    const { score, maxCombo, counts, starsCollected, starsTotal } = data;

    this.add
      .text(GAME_WIDTH / 2, 100, 'TRACK COMPLETE', {
        fontFamily: 'monospace',
        resolution: DPR,
        fontSize: '40px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_WIDTH / 2, 190, `SCORE  ${score}`, {
        fontFamily: 'monospace',
        resolution: DPR,
        fontSize: '48px',
        color: '#4ade80',
      })
      .setOrigin(0.5);

    this.add
      .text(
        GAME_WIDTH / 2,
        280,
        `Max combo  ${maxCombo}\n\nPerfect ${counts.perfect}   Good ${counts.good}   OK ${counts.ok}   Miss ${counts.miss}`,
        {
          fontFamily: 'monospace',
          resolution: DPR,
          fontSize: '20px',
          color: '#aaaacc',
          align: 'center',
          lineSpacing: 6,
        },
      )
      .setOrigin(0.5);

    this.add
      .text(GAME_WIDTH / 2, 350, `★ Stars  ${starsCollected}/${starsTotal}`, {
        fontFamily: 'monospace',
        resolution: DPR,
        fontSize: '20px',
        color: '#fde68a',
      })
      .setOrigin(0.5);

    const again = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 110, 'TAP OR PRESS SPACE TO PLAY AGAIN', {
        fontFamily: 'monospace',
        resolution: DPR,
        fontSize: '22px',
        color: '#4ade80',
      })
      .setOrigin(0.5);
    this.tweens.add({ targets: again, alpha: 0.3, duration: 600, yoyo: true, repeat: -1 });

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 65, 'M — change music', {
        fontFamily: 'monospace',
        resolution: DPR,
        fontSize: '16px',
        color: '#8888aa',
      })
      .setOrigin(0.5);

    this.input.once('pointerdown', () => this.scene.start('Game'));
    this.input.keyboard?.once('keydown-SPACE', () => this.scene.start('Game'));
    this.input.keyboard?.once('keydown-M', () => this.scene.start('SongSelect'));
  }
}
