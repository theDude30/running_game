import Phaser from 'phaser';
import {
  GAME_HEIGHT,
  GAME_WIDTH,
  WEATHER_COOL_COLOR,
  WEATHER_FOG_MAX_ALPHA,
  WEATHER_MAX_FREQUENCY_MS,
  WEATHER_MAX_SPEED,
  WEATHER_MIN_FREQUENCY_MS,
  WEATHER_MIN_SPEED,
  WEATHER_WARM_COLOR,
} from '../constants';
import type { WeatherMetrics } from '../audio/WeatherAnalyzer';

/**
 * The visual half of the music-reactive weather: rain driven by bass
 * (emission rate) and treble (speed/angle), fog driven by RMS volume, color
 * driven by spectral centroid, and a lightning flash on each detected bass
 * beat. See WeatherAnalyzer for how the metrics are computed.
 */
export class WeatherSystem {
  private readonly emitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly fog: Phaser.GameObjects.Rectangle;
  private readonly flash: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene) {
    if (!scene.textures.exists('weather-drop')) {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 3, 16);
      g.generateTexture('weather-drop', 3, 16);
      g.destroy();
    }

    this.emitter = scene.add.particles(0, 0, 'weather-drop', {
      x: { min: 0, max: GAME_WIDTH },
      y: -20,
      lifespan: 1400,
      angle: { min: 90, max: 100 },
      speed: WEATHER_MIN_SPEED,
      alpha: { start: 0.7, end: 0.1 },
      quantity: 1,
      frequency: WEATHER_MAX_FREQUENCY_MS,
      tint: WEATHER_COOL_COLOR,
    });
    this.emitter.setDepth(50);

    this.fog = scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xaab4c8, 0);
    this.fog.setDepth(40);

    this.flash = scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xffffff, 0);
    this.flash.setDepth(95);
  }

  update(m: WeatherMetrics, scene: Phaser.Scene): void {
    // Bass -> how many raindrops (emission rate)
    this.emitter.frequency = Phaser.Math.Linear(WEATHER_MAX_FREQUENCY_MS, WEATHER_MIN_FREQUENCY_MS, m.bass);

    // Treble -> particle speed & angle: sharp highs = fast, more slanted rain
    this.emitter.speed = Phaser.Math.Linear(WEATHER_MIN_SPEED, WEATHER_MAX_SPEED, m.treble);
    const spread = 5 + m.treble * 25;
    this.emitter.particleAngle = { min: 90 - spread * 0.3, max: 90 + spread };

    // Volume -> fog density
    this.fog.setAlpha(Phaser.Math.Clamp(m.volume * WEATHER_FOG_MAX_ALPHA, 0, WEATHER_FOG_MAX_ALPHA));

    // Centroid -> color: cool/bright for high pitch, warm/dark for low pitch
    const color = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(WEATHER_WARM_COLOR),
      Phaser.Display.Color.ValueToColor(WEATHER_COOL_COLOR),
      100,
      Math.round(Phaser.Math.Clamp(m.centroid, 0, 1) * 100),
    );
    this.emitter.setParticleTint(Phaser.Display.Color.GetColor(color.r, color.g, color.b));

    // Bass beat -> lightning flash
    if (m.beat) {
      this.flash.setAlpha(0.3 + m.bass * 0.35);
      scene.tweens.add({ targets: this.flash, alpha: 0, duration: 220 });
    }
  }

  setActive(on: boolean): void {
    this.emitter.setVisible(on);
    this.fog.setVisible(on);
  }
}
