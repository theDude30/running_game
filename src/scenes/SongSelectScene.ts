import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../constants';
import { decodeArrayBuffer, fetchYouTubeAudio, loadLocalFile } from '../audio/sources';
import { generateBeatmap } from '../beatmap/generate';
import { testBeatmap } from '../beatmap/testBeatmap';
import type { RunConfig } from '../beatmap/types';

export class SongSelectScene extends Phaser.Scene {
  private status!: Phaser.GameObjects.Text;
  private startPrompt!: Phaser.GameObjects.Text;
  private urlDom?: Phaser.GameObjects.DOMElement;
  private busy = false;
  private ready = false;

  constructor() {
    super('SongSelect');
  }

  create(): void {
    this.busy = false;
    this.ready = false;

    this.add
      .text(GAME_WIDTH / 2, 90, 'SELECT MUSIC', {
        fontFamily: 'monospace',
        fontSize: '44px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    this.button(180, 'FROM YOUTUBE', () => this.showUrlInput());
    this.button(240, 'LOAD AUDIO FILE', () => this.pickFile());
    this.button(300, 'TEST TRACK (silent metronome)', () => {
      this.registry.set('runConfig', { beatmap: testBeatmap } satisfies RunConfig);
      this.scene.start('Game');
    });

    this.status = this.add
      .text(GAME_WIDTH / 2, 470, '', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#8888aa',
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 120 },
      })
      .setOrigin(0.5);

    this.startPrompt = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 30, 'TAP OR PRESS SPACE TO START', {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#4ade80',
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.tweens.add({ targets: this.startPrompt, alpha: 0.3, duration: 600, yoyo: true, repeat: -1 });

    const begin = () => {
      if (this.ready) this.scene.start('Game');
    };
    this.input.on('pointerdown', begin);
    this.input.keyboard?.on('keydown-SPACE', begin);
  }

  private button(y: number, label: string, onClick: () => void): void {
    const t = this.add
      .text(GAME_WIDTH / 2, y, `[ ${label} ]`, {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#93c5fd',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    t.on('pointerover', () => t.setColor('#ffffff'));
    t.on('pointerout', () => t.setColor('#93c5fd'));
    t.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation(); // don't trigger the scene-level "start" tap
      if (!this.busy) onClick();
    });
  }

  private showUrlInput(): void {
    if (this.urlDom) {
      this.urlDom.setVisible(true);
      return;
    }
    const html = `
      <div style="display:flex;gap:8px;">
        <input id="yt-url" type="text" placeholder="https://www.youtube.com/watch?v=…"
          style="width:430px;padding:10px 12px;font-size:15px;font-family:monospace;
                 background:#1a1a2e;color:#fff;border:1px solid #4ade80;border-radius:6px;outline:none;" />
        <button id="yt-go"
          style="padding:10px 20px;font-size:15px;font-family:monospace;font-weight:bold;
                 background:#4ade80;color:#0a0a12;border:none;border-radius:6px;cursor:pointer;">GO</button>
      </div>`;
    this.urlDom = this.add.dom(GAME_WIDTH / 2, 375).createFromHTML(html);
    const input = this.urlDom.getChildByID('yt-url') as HTMLInputElement;
    const go = () => {
      const url = input.value.trim();
      if (!url) return;
      this.urlDom?.setVisible(false);
      void this.prepare(() => fetchYouTubeAudio(url, (m) => this.setStatus(m)), 'YouTube track');
    };
    (this.urlDom.getChildByID('yt-go') as HTMLButtonElement).addEventListener('click', go);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
      e.stopPropagation(); // typing must not trigger game keys
    });
    input.focus();
  }

  private pickFile(): void {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = 'audio/*,.mp3,.m4a,.ogg,.wav';
    el.addEventListener('change', () => {
      const file = el.files?.[0];
      if (file) void this.prepare(() => loadLocalFile(file), file.name.replace(/\.[^.]+$/, ''));
    });
    el.click();
  }

  private async prepare(getData: () => Promise<ArrayBuffer>, name: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.ready = false;
    this.startPrompt.setVisible(false);
    try {
      const raw = await getData();
      this.setStatus('Decoding audio…');
      const buffer = await decodeArrayBuffer(raw);

      // mono mixdown for analysis
      const mono = new Float32Array(buffer.length);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
      }

      const beatmap = await generateBeatmap(mono, buffer.sampleRate, buffer.duration, name, (p) =>
        this.setStatus(
          p.stage === 'analyzing' ? `Analyzing beats… ${Math.round(p.pct * 100)}%` : 'Building level…',
        ),
      );
      if (beatmap.events.length < 5) {
        throw new Error('Could not detect enough beats in this audio.');
      }

      this.registry.set('runConfig', { beatmap, audioBuffer: buffer } satisfies RunConfig);
      this.setStatus(
        `♪ ${name}\n~${beatmap.bpm} BPM · ${beatmap.events.length} obstacles · ${Math.round(beatmap.duration)}s`,
        '#4ade80',
      );
      this.ready = true;
      this.startPrompt.setVisible(true);
    } catch (err) {
      this.setStatus(`✗ ${err instanceof Error ? err.message : String(err)}`, '#ef4444');
    } finally {
      this.busy = false;
    }
  }

  private setStatus(msg: string, color = '#8888aa'): void {
    this.status.setText(msg).setColor(color);
  }
}
