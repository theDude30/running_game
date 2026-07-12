import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../constants';

/**
 * Unified keyboard + touch input. Emits:
 *   'jump'            — space / up / tap anywhere outside control pads (edge-triggered)
 *   'thrust' (boolean) — same keys/area, held state (flying mode's climb control)
 *   'duck' (boolean)  — down arrow held / left pad held
 *   'kick'            — X / F / right kick pad
 */
export class InputController extends Phaser.Events.EventEmitter {
  private zones: { x: number; y: number; r: number }[] = [];
  private duckPointerId: number | null = null;
  private thrustPointerId: number | null = null;

  constructor(scene: Phaser.Scene) {
    super();

    const kb = scene.input.keyboard;
    const onJumpKeyDown = (e: KeyboardEvent) => {
      if (!e.repeat) {
        this.emit('jump');
        this.emit('thrust', true);
      }
    };
    const onJumpKeyUp = () => this.emit('thrust', false);
    kb?.on('keydown-SPACE', onJumpKeyDown);
    kb?.on('keydown-UP', onJumpKeyDown);
    kb?.on('keyup-SPACE', onJumpKeyUp);
    kb?.on('keyup-UP', onJumpKeyUp);
    kb?.on('keydown-DOWN', (e: KeyboardEvent) => {
      if (!e.repeat) this.emit('duck', true);
    });
    kb?.on('keyup-DOWN', () => this.emit('duck', false));
    const onKickKey = (e: KeyboardEvent) => {
      if (!e.repeat) this.emit('kick');
    };
    kb?.on('keydown-X', onKickKey);
    kb?.on('keydown-F', onKickKey);

    const touch = scene.sys.game.device.input.touch;
    let duckZone: { x: number; y: number; r: number } | null = null;
    let kickZone: { x: number; y: number; r: number } | null = null;
    if (touch) {
      duckZone = { x: 110, y: GAME_HEIGHT - 90, r: 75 };
      kickZone = { x: GAME_WIDTH - 110, y: GAME_HEIGHT - 90, r: 75 };
      this.zones.push(duckZone, kickZone);
      this.drawPad(scene, duckZone, 'DUCK');
      this.drawPad(scene, kickZone, 'KICK');
    }

    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (duckZone && this.inZone(p, duckZone)) {
        this.duckPointerId = p.id;
        this.emit('duck', true);
        return;
      }
      if (kickZone && this.inZone(p, kickZone)) {
        this.emit('kick');
        return;
      }
      if (this.inExcluded(p)) return;
      this.thrustPointerId = p.id;
      this.emit('jump');
      this.emit('thrust', true);
    });
    scene.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.id === this.duckPointerId) {
        this.duckPointerId = null;
        this.emit('duck', false);
      }
      if (p.id === this.thrustPointerId) {
        this.thrustPointerId = null;
        this.emit('thrust', false);
      }
    });
  }

  /** Areas (e.g. the pause button) where a tap must not count as a jump. */
  exclude(x: number, y: number, r: number): void {
    this.zones.push({ x, y, r });
  }

  private inZone(p: Phaser.Input.Pointer, z: { x: number; y: number; r: number }): boolean {
    return Phaser.Math.Distance.Between(p.x, p.y, z.x, z.y) <= z.r;
  }

  private inExcluded(p: Phaser.Input.Pointer): boolean {
    return this.zones.some((z) => this.inZone(p, z));
  }

  private drawPad(scene: Phaser.Scene, z: { x: number; y: number; r: number }, label: string): void {
    scene.add.circle(z.x, z.y, z.r, 0xffffff, 0.08).setStrokeStyle(2, 0xffffff, 0.2).setDepth(90);
    scene.add
      .text(z.x, z.y, label, { fontFamily: 'monospace', fontSize: '20px', color: '#ffffff' })
      .setOrigin(0.5)
      .setAlpha(0.4)
      .setDepth(90);
  }
}
