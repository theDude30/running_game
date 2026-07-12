import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './constants';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { ResultsScene } from './scenes/ResultsScene';

// Fixed internal resolution (16:9). Scale.FIT letterboxes it onto any
// phone/tablet/desktop screen while keeping game coordinates constant —
// gameplay code never needs to care about the physical screen size.
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#0a0a12',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    // duck-hold + jump tap + kick tap can be simultaneous on touch
    activePointers: 3,
  },
  scene: [MenuScene, GameScene, ResultsScene],
});

if (import.meta.env.DEV) {
  // dev-console access for debugging: window.__game
  (window as unknown as Record<string, unknown>).__game = game;
}
