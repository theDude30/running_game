import Phaser from 'phaser';
import { DPR, GAME_HEIGHT, GAME_WIDTH } from './constants';
import { MenuScene } from './scenes/MenuScene';
import { SongSelectScene } from './scenes/SongSelectScene';
import { GameScene } from './scenes/GameScene';
import { ResultsScene } from './scenes/ResultsScene';

// Fixed internal resolution (16:9). Scale.FIT letterboxes it onto any
// phone/tablet/desktop screen while keeping game coordinates constant —
// gameplay code never needs to care about the physical screen size.
// The canvas backing store is DPR× larger than the logical 960×540 so it
// maps ~1:1 to physical pixels on high-DPI screens; each scene's camera
// zooms by DPR to compensate (see DPR in constants.ts).
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: Math.round(GAME_WIDTH * DPR),
  height: Math.round(GAME_HEIGHT * DPR),
  backgroundColor: '#0a0a12',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    // Trilinear mipmapping removes minification shimmer on the sprite art.
    // WebGL1 only mipmaps power-of-two textures — which is exactly why the
    // sprite atlas is packed to POT dimensions (see scripts/pack-atlas.py);
    // non-POT textures (generated particle/spinner textures) are unaffected.
    mipmapFilter: 'LINEAR_MIPMAP_LINEAR',
  },
  input: {
    // duck-hold + jump tap + kick tap can be simultaneous on touch
    activePointers: 3,
  },
  dom: {
    createContainer: true, // for the YouTube URL input overlay
  },
  scene: [MenuScene, SongSelectScene, GameScene, ResultsScene],
});

if (import.meta.env.DEV) {
  // dev-console access for debugging: window.__game / window.__generateBeatmap
  const w = window as unknown as Record<string, unknown>;
  w.__game = game;
  void import('./beatmap/generate').then((m) => {
    w.__generateBeatmap = m.generateBeatmap;
  });
}
