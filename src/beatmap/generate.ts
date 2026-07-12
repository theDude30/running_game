import type { Beatmap, BeatEvent, ObstacleType } from './types';
import { FFT } from './fft';

/**
 * Turns decoded audio into a beatmap:
 *   band-split spectral-flux onsets → beat-grid snapping → energy gating
 *   (quiet sections become rest stretches) → density filter → feasibility
 *   pass (no physically unclearable sequences) → obstacle assignment.
 * Deterministic: same audio in, same level out.
 */

const WIN = 1024;
const HOP = 512;
const LOW_BAND_HZ = 160; // kick drum energy lives below this
const MID_BAND_HZ = 4000;
const MIN_GAP = 0.45; // reaction-time floor between obstacles (seconds)
const FIRST_EVENT_AT = 3; // give the player a running start
const PEAK_RATIO = 1.5; // peak must exceed local mean by this factor
const GRID_SNAP_TOLERANCE = 0.09; // onsets this close to the beat grid snap onto it
const OFFGRID_MIN_STRENGTH = 0.5; // weaker off-grid onsets are noise → dropped
const REST_ENERGY_RATIO = 0.35; // sections quieter than this × p75 get no obstacles
const MAX_PER_WINDOW = 7; // density cap…
const WINDOW_SEC = 4; // …per this many seconds
const JUMP_RECOVERY = 0.75; // seconds the hero may be airborne after a forced jump
const REST_EVERY = 18; // guarantee an empty stretch at least this often…
const REST_LEN = 2.8; // …of at least this length (carved at the weakest spot)
const MAX_SILENCE_GAP = 12; // never leave the player with nothing to react to this long, start or mid-song
const GAP_RESCUE_COUNT = 3; // onsets to rescue from the energy gate per over-long gap
// Chroma (key/mode) analysis needs its own, much larger FFT window than
// onset detection: WIN's ~43Hz bin resolution is coarser than a semitone at
// these frequencies (a semitone at C4 is ~15Hz wide), so pitch-class energy
// bleeds across neighboring bins and corrupts the profile. A wide window is
// fine here since we only need one whole-track-averaged profile, not fine
// time resolution — verified empirically: 1024 scatters a pure C-minor
// triad's energy across 5+ pitch classes, 8192 (~5Hz/bin) resolves it cleanly.
const CHROMA_WIN = 8192;
const CHROMA_MIN_HZ = 80; // ignore sub-bass rumble/noise when building the chroma profile
const CHROMA_MAX_HZ = 5000; // ignore percussive/noise energy above the tonal range
const HAPPY_MIN_BPM = 110; // major-key tracks at/above this tempo read as upbeat, not just "not sad"

// Krumhansl-Kessler key profiles: empirically measured perceived "fit" of
// each scale degree to a major/minor tonic, the standard tool for audio key
// detection. Index 0 = the tonic itself.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

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
  const frameSec = HOP / sampleRate;

  const lowFlux = new Float32Array(frameCount);
  const midFlux = new Float32Array(frameCount);
  const rms = new Float32Array(frameCount);
  const windowed = new Float32Array(WIN);
  const mags = new Float32Array(WIN / 2);
  const prev = new Float32Array(WIN / 2);
  const hann = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (WIN - 1)));

  for (let f = 0; f < frameCount; f++) {
    const off = f * HOP;
    let sumSq = 0;
    for (let i = 0; i < WIN; i++) {
      const s = channel[off + i];
      windowed[i] = s * hann[i];
      sumSq += s * s;
    }
    rms[f] = Math.sqrt(sumSq / WIN);
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

    if (f % 4000 === 3999) {
      onProgress?.({ stage: 'analyzing', pct: f / frameCount });
      await new Promise((r) => setTimeout(r, 0)); // keep the UI alive
    }
  }

  onProgress?.({ stage: 'building', pct: 1 });

  const onsets = [
    ...pickPeaks(lowFlux, frameSec, 'low'),
    ...pickPeaks(midFlux, frameSec, 'mid'),
  ];
  const bpm = estimateBpm(lowFlux, midFlux, frameSec);
  const snapped = snapToGrid(onsets, bpm);
  const gated = gateByEnergy(snapped, rms, frameSec);
  const energetic = capLongSilences(gated, snapped);
  const spaced = densityFilter(energetic, duration);
  const breathing = carveRests(spaced, duration);
  const events = assignTypes(breathing);
  makeFeasible(events);
  const chroma = computeChroma(channel, sampleRate);
  const weatherType = pickWeatherType(chroma, bpm);
  return { name, bpm, duration, weatherType, events };
}

/** Whole-track-averaged 12-bin chroma profile for key/mode detection. */
function computeChroma(channel: Float32Array, sampleRate: number): Float32Array {
  const chroma = new Float32Array(12);
  if (channel.length < CHROMA_WIN) return chroma;

  const fft = new FFT(CHROMA_WIN);
  const binHz = sampleRate / CHROMA_WIN;
  const minBin = Math.max(1, Math.round(CHROMA_MIN_HZ / binHz));
  const maxBin = Math.min(CHROMA_WIN / 2 - 1, Math.round(CHROMA_MAX_HZ / binHz));
  const hann = new Float32Array(CHROMA_WIN);
  for (let i = 0; i < CHROMA_WIN; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (CHROMA_WIN - 1)));
  const windowed = new Float32Array(CHROMA_WIN);
  const mags = new Float32Array(CHROMA_WIN / 2);

  const frameCount = Math.floor((channel.length - CHROMA_WIN) / CHROMA_WIN);
  for (let f = 0; f < frameCount; f++) {
    const off = f * CHROMA_WIN;
    for (let i = 0; i < CHROMA_WIN; i++) windowed[i] = channel[off + i] * hann[i];
    fft.magnitudes(windowed, mags);
    for (let b = minBin; b <= maxBin; b++) {
      const freq = b * binHz;
      const pitchClass = ((Math.round(12 * Math.log2(freq / 440)) % 12) + 12) % 12;
      chroma[pitchClass] += mags[b];
    }
  }
  return chroma;
}

/**
 * Major vs. minor from the track's averaged chroma profile, correlated
 * against the Krumhansl-Kessler tonal profiles at all 12 possible tonics —
 * whichever mode's best-fitting tonic correlates higher wins. This is the
 * standard MIR key-detection technique, and mode (not the specific tonic)
 * is the closest audio-only proxy for "happy" (major) vs. "sad" (minor).
 */
function detectMode(chroma: Float32Array): 'major' | 'minor' {
  let total = 0;
  for (let i = 0; i < 12; i++) total += chroma[i];
  if (total === 0) return 'major';
  const normalized = Array.from(chroma, (v) => v / total);

  let bestMajor = -Infinity;
  let bestMinor = -Infinity;
  for (let tonic = 0; tonic < 12; tonic++) {
    bestMajor = Math.max(bestMajor, correlate(normalized, MAJOR_PROFILE, tonic));
    bestMinor = Math.max(bestMinor, correlate(normalized, MINOR_PROFILE, tonic));
  }
  return bestMajor >= bestMinor ? 'major' : 'minor';
}

/** Pearson correlation between the chroma vector and a key profile rotated to `tonic`. */
function correlate(chroma: number[], profile: number[], tonic: number): number {
  const rotated = profile.map((_, i) => profile[(i - tonic + 12) % 12]);
  const meanA = chroma.reduce((a, b) => a + b, 0) / 12;
  const meanB = rotated.reduce((a, b) => a + b, 0) / 12;
  let num = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < 12; i++) {
    const da = chroma[i] - meanA;
    const db = rotated[i] - meanB;
    num += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  const denom = Math.sqrt(denomA * denomB);
  return denom > 0 ? num / denom : 0;
}

function pickWeatherType(chroma: Float32Array, bpm: number): 'none' | 'rain' | 'snow' {
  if (detectMode(chroma) === 'minor') return 'rain'; // moody/sad -> rain
  return bpm >= HAPPY_MIN_BPM ? 'none' : 'snow'; // major+fast (happy) -> clear; major+slow (calm) -> snow
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

/**
 * Find the beat-grid phase that best explains the strong onsets, then snap
 * near-grid onsets onto eighth-note positions (this is what makes obstacles
 * feel ON the music instead of merely near it). Weak off-grid onsets are
 * treated as detection noise and dropped; strong ones survive as syncopation.
 */
function snapToGrid(onsets: Onset[], bpm: number): Onset[] {
  const beat = 60 / bpm;
  const grid = beat / 2; // eighth notes

  let bestPhase = 0;
  let bestScore = -Infinity;
  for (let phase = 0; phase < grid; phase += grid / 24) {
    let score = 0;
    for (const o of onsets) {
      const d = distToGrid(o.time, phase, grid);
      if (d < 0.05) score += o.strength * (1 - d / 0.05);
    }
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }

  const out: Onset[] = [];
  for (const o of onsets) {
    const d = distToGrid(o.time, bestPhase, grid);
    if (d <= GRID_SNAP_TOLERANCE) {
      const snappedTime = Math.round((o.time - bestPhase) / grid) * grid + bestPhase;
      out.push({ ...o, time: snappedTime });
    } else if (o.strength >= OFFGRID_MIN_STRENGTH) {
      out.push(o);
    }
  }
  return out;
}

function distToGrid(t: number, phase: number, grid: number): number {
  const pos = (t - phase) % grid;
  return Math.min(Math.abs(pos), grid - Math.abs(pos));
}

/**
 * Quiet parts of the song produce empty road: drop events where the local
 * loudness falls well below the track's typical level.
 */
function gateByEnergy(onsets: Onset[], rms: Float32Array, frameSec: number): Onset[] {
  const n = rms.length;
  if (n === 0) return onsets;

  // ~1s smoothed loudness
  const smoothN = Math.max(1, Math.round(1 / frameSec));
  const smooth = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += rms[i];
    if (i >= smoothN) acc -= rms[i - smoothN];
    smooth[i] = acc / Math.min(i + 1, smoothN);
  }
  const sorted = Array.from(smooth).sort((a, b) => a - b);
  const p75 = sorted[Math.floor(sorted.length * 0.75)] || 0;
  const floor = p75 * REST_ENERGY_RATIO;

  return onsets.filter((o) => {
    const f = Math.min(n - 1, Math.round(o.time / frameSec));
    return smooth[f] >= floor;
  });
}

/**
 * A genuinely quiet stretch (intro, breakdown, bridge) can leave the energy
 * gate with nothing at all for 20-30+ seconds — correct per-song, but
 * indistinguishable from "the game stopped generating obstacles" to a
 * player watching empty road with no idea whether it's the song or a bug.
 * Never let ANY gap (start-to-first-event, or between two consecutive
 * events) run longer than MAX_SILENCE_GAP: pull the strongest onsets the
 * gate dropped back in for that stretch, even though it's technically quiet.
 */
function capLongSilences(gated: Onset[], allSnapped: Onset[]): Onset[] {
  const rescued: Onset[] = [];
  const rescueGap = (from: number, to: number) => {
    const candidates = allSnapped
      .filter((o) => o.time > from && o.time < to)
      .sort((a, b) => b.strength - a.strength);
    let count = 0;
    for (const o of candidates) {
      if (count >= GAP_RESCUE_COUNT) break;
      if (rescued.every((r) => Math.abs(r.time - o.time) >= MIN_GAP)) {
        rescued.push(o);
        count++;
      }
    }
  };

  const bounds = [FIRST_EVENT_AT, ...gated.map((o) => o.time)];
  for (let i = 1; i < bounds.length; i++) {
    if (bounds[i] - bounds[i - 1] > MAX_SILENCE_GAP) rescueGap(bounds[i - 1], bounds[i]);
  }

  return rescued.length ? [...gated, ...rescued].sort((a, b) => a.time - b.time) : gated;
}

/** Reaction-time min gap plus a hard cap per rolling window. */
function densityFilter(onsets: Onset[], duration: number): Onset[] {
  const usable = onsets
    .filter((o) => o.time >= FIRST_EVENT_AT && o.time <= duration - 1.5)
    .sort((a, b) => b.strength - a.strength);

  const kept: Onset[] = [];
  for (const o of usable) {
    if (!kept.every((k) => Math.abs(k.time - o.time) >= MIN_GAP)) continue;
    const windowCount = kept.filter((k) => Math.abs(k.time - o.time) <= WINDOW_SEC / 2).length;
    if (windowCount >= MAX_PER_WINDOW) continue;
    kept.push(o);
  }
  return kept.sort((a, b) => a.time - b.time);
}

/**
 * Songs with constant loudness never trigger the energy gate, so breathing
 * room is guaranteed structurally: in every REST_EVERY-second window that
 * lacks a natural pause, delete the weakest REST_LEN-second span of events.
 * The player gets empty road, and it lands where the music matters least.
 */
function carveRests(onsets: Onset[], duration: number): Onset[] {
  const removed = new Set<Onset>();
  for (let w = FIRST_EVENT_AT; w < duration; w += REST_EVERY) {
    const inWindow = onsets.filter((o) => o.time >= w && o.time < w + REST_EVERY);
    if (inWindow.length === 0) continue;

    // natural gap already present?
    const times = [w, ...inWindow.map((o) => o.time), w + REST_EVERY];
    let hasGap = false;
    for (let i = 1; i < times.length; i++) {
      if (times[i] - times[i - 1] >= REST_LEN) hasGap = true;
    }
    if (hasGap) continue;

    let bestStart = w;
    let bestCost = Infinity;
    for (let s = w; s + REST_LEN <= w + REST_EVERY; s += 0.5) {
      const cost = inWindow
        .filter((o) => o.time >= s && o.time < s + REST_LEN)
        .reduce((sum, o) => sum + o.strength, 0);
      if (cost < bestCost) {
        bestCost = cost;
        bestStart = s;
      }
    }
    for (const o of inWindow) {
      if (o.time >= bestStart && o.time < bestStart + REST_LEN) removed.add(o);
    }
  }
  return onsets.filter((o) => !removed.has(o));
}

/**
 * Section-based typing: consecutive events between pauses form a musical
 * phrase, and each phrase gets a movement flavor — duck phrases (mid-band
 * heavy: slide under branch chains), jump phrases (bass heavy: pits, walls,
 * stompable zombies), or mixed. Without this, dense songs collapse into
 * all-jump levels because a duck is impossible mid-jump-chain.
 */
function assignTypes(onsets: Onset[]): BeatEvent[] {
  const rank = (band: 'low' | 'mid') => {
    const strengths = onsets
      .filter((o) => o.band === band)
      .map((o) => o.strength)
      .sort((a, b) => a - b);
    return (s: number) =>
      strengths.length ? strengths.findIndex((v) => v >= s) / strengths.length : 0;
  };
  const lowRank = rank('low');
  const midRank = rank('mid');

  const events: BeatEvent[] = [];
  let i = 0;
  let sectionIdx = 0;
  while (i < onsets.length) {
    let end = i + 1;
    while (
      end < onsets.length &&
      end - i < 10 &&
      onsets[end].time - onsets[end - 1].time < 1.5
    ) {
      end++;
    }
    const section = onsets.slice(i, end);
    const midShare = section.filter((o) => o.band === 'mid').length / section.length;
    // force alternation so bass-heavy songs still get duck phrases
    const mode: 'duck' | 'jump' | 'mixed' =
      midShare >= 0.55 || sectionIdx % 3 === 2 ? 'duck' : midShare <= 0.25 ? 'jump' : 'mixed';

    let hazardStreak = 0;
    section.forEach((o, j) => {
      let type: ObstacleType;
      if (mode === 'duck') {
        type = o.band === 'mid' && midRank(o.strength) > 0.6 ? 'zombie' : 'branch';
      } else if (o.band === 'low') {
        const r = lowRank(o.strength);
        if (r > 0.85) {
          // top-tier bass hits: cycle through walls and lava, not walls alone
          const cycle = (i + j) % 3;
          type = cycle === 0 ? 'hardWall' : cycle === 1 ? 'breakableWall' : 'lava';
        } else if (r > 0.55) type = 'lava';
        else type = 'pit';
      } else {
        const r = midRank(o.strength);
        if (r > 0.6) type = 'zombie';
        else type = mode === 'mixed' ? 'branch' : 'pit';
      }
      // long runs of ground hazards get a stomp target to break monotony —
      // pit and lava both count, so lava soaking up former pits doesn't
      // starve this of zombies
      const isGroundHazard = type === 'pit' || type === 'lava';
      if (isGroundHazard && ++hazardStreak % 3 === 0) type = 'zombie';
      if (!isGroundHazard) hazardStreak = 0;
      events.push({ time: o.time, type });
    });
    i = end;
    sectionIdx++;
  }
  return events;
}

/**
 * No unwinnable sequences. An obstacle that forces a jump leaves the hero
 * airborne for up to JUMP_RECOVERY seconds; inside that window:
 *  - a branch (duck) is physically unclearable → becomes a zombie, which
 *    self-solves airborne (falling onto it = stomp) and grounded (kick),
 *    so the musical hit is kept without unfairness;
 *  - a wall demands full jump height the hero may no longer have → becomes
 *    a pit, which an airborne hero simply sails over.
 */
function makeFeasible(events: BeatEvent[]): void {
  const forcesJump = (t: ObstacleType) =>
    t === 'pit' || t === 'hardWall' || t === 'breakableWall' || t === 'lava';
  let airborneUntil = -Infinity;
  for (const e of events) {
    if (e.time < airborneUntil) {
      if (e.type === 'branch') e.type = 'zombie';
      else if (e.type === 'hardWall' || e.type === 'breakableWall') e.type = 'pit';
    }
    if (forcesJump(e.type)) {
      airborneUntil = e.time + JUMP_RECOVERY;
    }
  }
}
