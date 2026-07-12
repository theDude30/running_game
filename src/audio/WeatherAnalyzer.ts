import {
  WEATHER_BASS_HZ,
  WEATHER_BEAT_AVG_LERP,
  WEATHER_BEAT_MIN_ENERGY,
  WEATHER_BEAT_MIN_GAP,
  WEATHER_BEAT_RATIO,
  WEATHER_LERP_BASS,
  WEATHER_LERP_CENTROID,
  WEATHER_LERP_TREBLE,
  WEATHER_LERP_VOLUME,
  WEATHER_TREBLE_HZ,
} from '../constants';

/**
 * Turns live FFT output (Web Audio AnalyserNode) into smoothed 0..1 weather
 * parameters. Raw per-frame FFT bins are noisy — feeding them straight to
 * particle/visual params makes weather flicker unnaturally — so every
 * metric here is lerped toward its raw reading rather than snapped to it,
 * and "beat" triggers use peak detection (current value vs. a rolling
 * average) with a cooldown, not a raw threshold, so a sustained loud
 * passage doesn't fire a beat every single frame.
 */

export interface WeatherMetrics {
  bass: number; // 0..1 smoothed low-band energy → emission rate / shake size
  treble: number; // 0..1 smoothed high-band energy → particle speed/angle
  volume: number; // 0..1 smoothed RMS loudness → fog density
  centroid: number; // 0..1 smoothed spectral centroid → color (cool vs warm)
  beat: boolean; // one-shot: bass just peaked over its rolling average
}

export class WeatherAnalyzer {
  private readonly freqData: Uint8Array<ArrayBuffer>;
  private readonly timeData: Float32Array<ArrayBuffer>;
  private readonly bassBinRange: [number, number];
  private readonly trebleBinRange: [number, number];

  private bass = 0;
  private treble = 0;
  private volume = 0;
  private centroid = 0;
  private bassRollingAvg = 0;
  private lastBeatAt = -Infinity;

  constructor(
    private readonly analyser: AnalyserNode,
    sampleRate: number,
    /** Seconds clock used for the beat cooldown (pass the Conductor's songTime getter). */
    private readonly clockSec: () => number,
  ) {
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0; // we do our own smoothing, deliberately
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Float32Array(this.analyser.fftSize);
    const binHz = sampleRate / this.analyser.fftSize;
    this.bassBinRange = [
      Math.max(1, Math.round(WEATHER_BASS_HZ[0] / binHz)),
      Math.round(WEATHER_BASS_HZ[1] / binHz),
    ];
    this.trebleBinRange = [
      Math.round(WEATHER_TREBLE_HZ[0] / binHz),
      Math.min(this.freqData.length - 1, Math.round(WEATHER_TREBLE_HZ[1] / binHz)),
    ];
  }

  sample(): WeatherMetrics {
    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getFloatTimeDomainData(this.timeData);

    const rawBass = bandEnergy(this.freqData, this.bassBinRange);
    const rawTreble = bandEnergy(this.freqData, this.trebleBinRange);
    const rawVolume = rms(this.timeData);
    const rawCentroid = spectralCentroid(this.freqData);

    this.bass = lerp(this.bass, rawBass, WEATHER_LERP_BASS);
    this.treble = lerp(this.treble, rawTreble, WEATHER_LERP_TREBLE);
    this.volume = lerp(this.volume, rawVolume, WEATHER_LERP_VOLUME);
    this.centroid = lerp(this.centroid, rawCentroid, WEATHER_LERP_CENTROID);

    this.bassRollingAvg = lerp(this.bassRollingAvg, rawBass, WEATHER_BEAT_AVG_LERP);
    const now = this.clockSec();
    let beat = false;
    if (
      rawBass > this.bassRollingAvg * WEATHER_BEAT_RATIO &&
      rawBass > WEATHER_BEAT_MIN_ENERGY &&
      now - this.lastBeatAt > WEATHER_BEAT_MIN_GAP
    ) {
      beat = true;
      this.lastBeatAt = now;
    }

    return { bass: this.bass, treble: this.treble, volume: this.volume, centroid: this.centroid, beat };
  }
}

function bandEnergy(freqData: Uint8Array, [lo, hi]: [number, number]): number {
  let sum = 0;
  let count = 0;
  for (let i = lo; i <= hi && i < freqData.length; i++) {
    sum += freqData[i];
    count++;
  }
  return count ? sum / count / 255 : 0;
}

function rms(timeData: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < timeData.length; i++) sumSq += timeData[i] * timeData[i];
  return Math.min(1, Math.sqrt(sumSq / timeData.length) * 3.5); // *3.5: typical music RMS rarely nears 1.0
}

function spectralCentroid(freqData: Uint8Array): number {
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < freqData.length; i++) {
    weighted += i * freqData[i];
    total += freqData[i];
  }
  return total > 0 ? weighted / total / freqData.length : 0;
}

function lerp(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}
