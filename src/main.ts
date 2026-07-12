import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';

// Fixed internal resolution (16:9). Scale.FIT letterboxes it onto any
// phone/tablet/desktop screen while keeping game coordinates constant —
// gameplay code never needs to care about the physical screen size.
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#0a0a12',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 2000 },
      debug: false,
    },
  },
  scene: [BootScene],
});
