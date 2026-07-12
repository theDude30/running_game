import type { Beatmap, BeatEvent, ObstacleType } from './types';
import { FFT } from './fft';

/**
 * Turns decoded audio into a beatmap: band-split spectral-flux onset
 * detection → adaptive peak picking → density filter → deterministic
 * obstacle assignment. Same audio in, same level out — required for
 * fair multiplayer later.
 */

const WIN = 1024;
const HOP = 512;
const LOW_BAND_HZ = 160; // kick drum energy lives below this
const MID_BAND_HZ = 4000;
const MIN_GAP = 0.42; // reaction-time floor between obstacles (seconds)
const FIRST_EVENT_AT = 3; // give the player a running start
const PEAK_RATIO = 1.4; // peak must exceed local mean by this factor

export interface AnalysisProgress {
  stage: 'analyzing' | 'building';
  pct: number;
}

interface Onset {
  time: number;
  strength: number; // 0..1 relative to the strongest onset in its band
  band: 'low' | 'mid';
}

export async function generateBeatmap(
  channel: Float32Array,
  sampleRate: number,
  duration: number,
  name: string,
  onProgress?: (p: AnalysisProgress) => void,
): Promise<Beatmap> {
  const fft = new FFT(WIN);
  const frameCount = Math.max(0, Math.floor((channel.length - WIN) / HOP));
  const binHz = sampleRate / WIN;
  const lowMax = Math.max(2, Math.round(LOW_BAND_HZ / binHz));
  const midMax = Math.min(WIN / 2, Math.round(MID_BAND_HZ / binHz));

  const lowFlux = new Float32Array(frameCount);
  const midFlux = new Float32Array(frameCount);
  const windowed = new Float32Array(WIN);
  const mags = new Float32Array(WIN / 2);
  const prev = new Float32Array(WIN / 2);
  const hann = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (WIN - 1)));

  for (let f = 0; f < frameCount; f++) {
    const off = f * HOP;
    for (let i = 0; i < WIN; i++) windowed[i] = channel[off + i] * hann[i];
    fft.magnitudes(windowed, mags);

    let low = 0;
    let mid = 0;
    for (let b = 1; b < midMax; b++) {
      const rise = mags[b] - prev[b];
      if (rise > 0) {
        if (b <= lowMax) low += rise;
        else mid += rise;
      }
      prev[b] = mags[b];
    }
    lowFlux[f] = low;
    midFlux[f] = mid;

    if (f % 2000 === 1999) {
      onProgress?.({ stage: 'analyzing', pct: f / frameCount });
      await new Promise((r) => setTimeout(r, 0)); // keep the UI alive
    }
  }

  onProgress?.({ stage: 'building', pct: 1 });
  const frameSec = HOP / sampleRate;
  const onsets = [
    ...pickPeaks(lowFlux, frameSec, 'low'),
    ...pickPeaks(midFlux, frameSec, 'mid'),
  ];
  const bpm = estimateBpm(lowFlux, midFlux, frameSec);
  const events = toEvents(onsets, duration);
  return { name, bpm, duration, events };
}

/** Adaptive-threshold local-maximum peak picking on a flux envelope. */
function pickPeaks(flux: Float32Array, frameSec: number, band: 'low' | 'mid'): Onset[] {
  const n = flux.length;
  if (n === 0) return [];
  let globalMax = 0;
  for (let i = 0; i < n; i++) globalMax = Math.max(globalMax, flux[i]);
  if (globalMax === 0) return [];

  const HALF = 20; // ~±0.23s local window
  const peaks: Onset[] = [];
  for (let i = 2; i < n - 2; i++) {
    const v = flux[i];
    if (v < globalMax * 0.06) continue;
    if (v < flux[i - 1] || v <= flux[i + 1] || v < flux[i - 2] || v <= flux[i + 2]) continue;
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - HALF); j < Math.min(n, i + HALF); j++) {
      sum += flux[j];
      count++;
    }
    if (v > (sum / count) * PEAK_RATIO) {
      peaks.push({ time: i * frameSec, strength: v / globalMax, band });
    }
  }
  return peaks;
}

/** Autocorrelation of the combined flux envelope, folded into 70–180 BPM. */
function estimateBpm(low: Float32Array, mid: Float32Array, frameSec: number): number {
  const n = low.length;
  if (n < 100) return 120;
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) env[i] = low[i] + mid[i];
  const mean = env.reduce((a, b) => a + b, 0) / n;
  for (let i = 0; i < n; i++) env[i] -= mean;

  const minLag = Math.round(60 / 200 / frameSec); // 200 BPM
  const maxLag = Math.round(60 / 60 / frameSec); // 60 BPM
  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    if (s > bestScore) {
      bestScore = s;
      bestLag = lag;
    }
  }
  let bpm = 60 / (bestLag * frameSec);
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm);
}

/** Density-filter onsets and deterministically assign obstacle types. */
function toEvents(onsets: Onset[], duration: number): BeatEvent[] {
  const usable = onsets
    .filter((o) => o.time >= FIRST_EVENT_AT && o.time <= duration - 1.5)
    .sort((a, b) => b.strength - a.strength);

  const kept: Onset[] = [];
  for (const o of usable) {
    if (kept.every((k) => Math.abs(k.time - o.time) >= MIN_GAP)) kept.push(o);
  }
  kept.sort((a, b) => a.time - b.time);

  return kept.map((o, i) => ({ time: o.time, type: pickType(o, i) }));
}

function pickType(o: Onset, index: number): ObstacleType {
  if (o.band === 'low') {
    // strong kicks become walls, ordinary kicks become pits
    if (o.strength > 0.75) return index % 2 === 0 ? 'hardWall' : 'breakableWall';
    return 'pit';
  }
  if (o.strength > 0.8) return 'zombie';
  return 'branch';
}
