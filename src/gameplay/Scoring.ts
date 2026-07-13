import { RATING_WINDOW } from '../constants';

export type Rating = 'perfect' | 'good' | 'ok';

const BASE_POINTS: Record<Rating, number> = { perfect: 200, good: 150, ok: 100 };

export interface RunStats {
  score: number;
  maxCombo: number;
  counts: { perfect: number; good: number; ok: number; miss: number };
  starsCollected: number;
  starsTotal: number;
}

export class Scoring {
  score = 0;
  combo = 0;
  maxCombo = 0;
  counts = { perfect: 0, good: 0, ok: 0, miss: 0 };
  starsCollected = 0;
  starsTotal = 0;

  get multiplier(): number {
    if (this.combo >= 50) return 4;
    if (this.combo >= 25) return 3;
    if (this.combo >= 10) return 2;
    return 1;
  }

  /** Judge how close an action was to the beat. Null = obstacle cleared without a matched action. */
  static rate(delta: number | null): Rating {
    if (delta === null) return 'ok';
    const d = Math.abs(delta);
    if (d <= RATING_WINDOW.perfect) return 'perfect';
    if (d <= RATING_WINDOW.good) return 'good';
    return 'ok';
  }

  /** @returns points awarded (already multiplied). */
  addClear(rating: Rating, styleBonus = 0): number {
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.counts[rating] += 1;
    const points = (BASE_POINTS[rating] + styleBonus) * this.multiplier;
    this.score += points;
    return points;
  }

  miss(): void {
    this.combo = 0;
    this.counts.miss += 1;
  }

  /**
   * Flat bonus, deliberately not multiplied by the rhythm-timing combo —
   * stars are a separate collectible layer, not part of the beat-matching
   * scoring, so missing one carries no penalty and collecting one doesn't
   * interact with the multiplier.
   */
  collectStar(points: number): number {
    this.starsCollected += 1;
    this.score += points;
    return points;
  }

  /** One-time reward for first reaching a new floor — same flat, no-combo treatment as star bonuses. */
  addFloorBonus(points: number): void {
    this.score += points;
  }

  get stats(): RunStats {
    return {
      score: this.score,
      maxCombo: this.maxCombo,
      counts: { ...this.counts },
      starsCollected: this.starsCollected,
      starsTotal: this.starsTotal,
    };
  }
}
