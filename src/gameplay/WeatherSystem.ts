import Phaser from 'phaser';
import {
  GAME_HEIGHT,
  GAME_WIDTH,
  WEATHER_COOL_COLOR,
  WEATHER_FOG_MAX_ALPHA,
  WEATHER_RAIN_MAX_FREQUENCY_MS,
  WEATHER_RAIN_MAX_SPEED,
  WEATHER_RAIN_MIN_FREQUENCY_MS,
  WEATHER_RAIN_MIN_SPEED,
  WEATHER_SNOW_COLOR,
  WEATHER_SNOW_MAX_FREQUENCY_MS,
  WEATHER_SNOW_MAX_SPEED,
  WEATHER_SNOW_MIN_FREQUENCY_MS,
  WEATHER_SNOW_MIN_SPEED,
  WEATHER_WARM_COLOR,
} from '../constants';
import type { WeatherMetrics } from '../audio/WeatherAnalyzer';
import type { WeatherType } from '../beatmap/types';

/**
 * The visual half of the music-reactive weather. The archetype (none / rain
 * / snow) is fixed for the whole track — chosen once from the song's key
 * mode and tempo, see beatmap/generate.ts — while bass/treble/volume still
 * modulate its intensity in real time within that archetype. 'none' (happy,
 * upbeat major-key tracks) renders nothing at all: no rain, no snow, no fog.
 */
export class WeatherSystem {
  private readonly emitter: Phaser.GameObjects.Particles.ParticleEmitter | null;
  private readonly fog: Phaser.GameObjects.Rectangle;
  private readonly flash: Phaser.GameObjects.Rectangle;

  constructor(
    scene: Phaser.Scene,
    private readonly weatherType: WeatherType,
  ) {
    this.emitter = weatherType === 'none' ? null : buildEmitter(scene, weatherType);
    this.emitter?.setDepth(50);

    // Rectangle's constructor `fillAlpha` and its own `.alpha` are separate,
    // multiplied channels — fillAlpha=0 at construction would make the fill
    // permanently transparent regardless of later setAlpha() calls. Keep
    // fillAlpha at full and control visibility only through setAlpha().
    this.fog = scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xaab4c8, 1);
    this.fog.setDepth(40).setAlpha(0);

    this.flash = scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xffffff, 1);
    this.flash.setDepth(95).setAlpha(0);
  }

  update(m: WeatherMetrics, scene: Phaser.Scene): void {
    if (this.weatherType === 'none' || !this.emitter) return; // clear skies: nothing to update

    const isSnow = this.weatherType === 'snow';
    const minFreq = isSnow ? WEATHER_SNOW_MIN_FREQUENCY_MS : WEATHER_RAIN_MIN_FREQUENCY_MS;
    const maxFreq = isSnow ? WEATHER_SNOW_MAX_FREQUENCY_MS : WEATHER_RAIN_MAX_FREQUENCY_MS;
    const minSpeed = isSnow ? WEATHER_SNOW_MIN_SPEED : WEATHER_RAIN_MIN_SPEED;
    const maxSpeed = isSnow ? WEATHER_SNOW_MAX_SPEED : WEATHER_RAIN_MAX_SPEED;

    // Bass -> how many drops/flakes (emission rate)
    this.emitter.frequency = Phaser.Math.Linear(maxFreq, minFreq, m.bass);

    // Treble -> fall speed & angle: sharp highs = faster, more slanted/drifting
    this.emitter.speed = Phaser.Math.Linear(minSpeed, maxSpeed, m.treble);
    const spread = (isSnow ? 15 : 5) + m.treble * (isSnow ? 20 : 25);
    this.emitter.particleAngle = { min: 90 - spread * 0.3, max: 90 + spread };

    // Volume -> fog density
    this.fog.setAlpha(Phaser.Math.Clamp(m.volume * WEATHER_FOG_MAX_ALPHA, 0, WEATHER_FOG_MAX_ALPHA));

    if (isSnow) {
      this.emitter.setParticleTint(WEATHER_SNOW_COLOR); // snow stays a fixed pale color
    } else {
      // Centroid -> color: cool/bright for high pitch, warm/dark for low pitch
      const color = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(WEATHER_WARM_COLOR),
        Phaser.Display.Color.ValueToColor(WEATHER_COOL_COLOR),
        100,
        Math.round(Phaser.Math.Clamp(m.centroid, 0, 1) * 100),
      );
      this.emitter.setParticleTint(Phaser.Display.Color.GetColor(color.r, color.g, color.b));
    }

    // Bass beat -> lightning flash (rain only — snow doesn't get thunder)
    if (m.beat && !isSnow) {
      this.flash.setAlpha(0.3 + m.bass * 0.35);
      scene.tweens.add({ targets: this.flash, alpha: 0, duration: 220 });
    }
  }

  setActive(on: boolean): void {
    this.emitter?.setVisible(on);
    this.fog.setVisible(on);
  }
}

function buildEmitter(
  scene: Phaser.Scene,
  type: 'rain' | 'snow',
): Phaser.GameObjects.Particles.ParticleEmitter {
  const textureKey = type === 'rain' ? 'weather-drop' : 'weather-snow';
  if (!scene.textures.exists(textureKey)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    if (type === 'rain') {
      g.fillRect(0, 0, 3, 16);
      g.generateTexture(textureKey, 3, 16);
    } else {
      g.fillCircle(4, 4, 4);
      g.generateTexture(textureKey, 8, 8);
    }
    g.destroy();
  }

  return scene.add.particles(0, 0, textureKey, {
    x: { min: 0, max: GAME_WIDTH },
    y: -20,
    lifespan: type === 'rain' ? 1400 : 3200,
    angle: { min: 90, max: 100 },
    speed: type === 'rain' ? WEATHER_RAIN_MIN_SPEED : WEATHER_SNOW_MIN_SPEED,
    alpha: { start: type === 'rain' ? 0.7 : 0.85, end: 0.1 },
    quantity: 1,
    frequency: type === 'rain' ? WEATHER_RAIN_MAX_FREQUENCY_MS : WEATHER_SNOW_MAX_FREQUENCY_MS,
    tint: type === 'rain' ? WEATHER_COOL_COLOR : WEATHER_SNOW_COLOR,
  });
}
