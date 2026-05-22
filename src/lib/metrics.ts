/**
 * Reusable signal-processing utilities.
 * Used for weight trends on the Nutrition page and CTL/ATL training load later.
 */

/**
 * Exponentially weighted moving average.
 * Accepts nullable values — nulls carry the last computed trend forward unchanged.
 * Returns NaN for leading positions before the first non-null seed value.
 */
export function ewma(values: (number | null)[], alpha = 0.1): number[] {
  const result: number[] = [];
  let prev: number | null = null;

  for (const v of values) {
    if (prev === null) {
      if (v !== null) prev = v;
      result.push(prev ?? NaN);
    } else {
      if (v !== null) prev = alpha * v + (1 - alpha) * prev;
      result.push(prev);
    }
  }

  return result;
}

/**
 * Weekly rate of change at each point: trend[i] − trend[i−7].
 * Returns null for the first 7 positions and any index where either operand is NaN.
 */
export function weeklyRateOfChange(trend: number[]): (number | null)[] {
  return trend.map((v, i) => {
    if (i < 7 || isNaN(v) || isNaN(trend[i - 7])) return null;
    return +((v - trend[i - 7]).toFixed(2));
  });
}

/**
 * Estimates the date when the EWMA trend will reach targetValue,
 * using the slope over the last 14 valid data points.
 * Returns "—" when: slope is flat (< 0.001/day), moving the wrong direction,
 * or the projection is more than 3 years out.
 */
export function projectedTarget(trend: number[], targetValue: number): string {
  const valid = trend.filter(v => !isNaN(v));
  if (valid.length < 15) return '—';

  const last       = valid[valid.length - 1];
  const slopePerDay = (last - valid[valid.length - 15]) / 14;

  const movingToward =
    (targetValue < last && slopePerDay < 0) ||
    (targetValue > last && slopePerDay > 0);

  if (!movingToward || Math.abs(slopePerDay) < 0.001) return '—';

  const days = Math.round((targetValue - last) / slopePerDay);
  if (days > 365 * 3) return '—';

  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Percentage of total calories each macro contributes.
 *   Protein & carbs = 4 kcal/g, fat = 9 kcal/g.
 */
export function macroRatios(
  protein: number,
  carbs: number,
  fat: number,
): { proteinPct: number; carbsPct: number; fatPct: number } {
  const pKcal = protein * 4;
  const cKcal = carbs   * 4;
  const fKcal = fat     * 9;
  const total = pKcal + cKcal + fKcal;

  if (total === 0) return { proteinPct: 0, carbsPct: 0, fatPct: 0 };

  return {
    proteinPct: +((pKcal / total) * 100).toFixed(1),
    carbsPct:   +((cKcal / total) * 100).toFixed(1),
    fatPct:     +((fKcal / total) * 100).toFixed(1),
  };
}
