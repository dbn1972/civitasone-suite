/**
 * Forecast domain logic.
 *
 * Pure function: computes weighted revenue forecast per pipeline stage
 * by multiplying each active deal's valueMinor (bigint paise) by its
 * stage probability (0–100) and summing using bigint floor division.
 *
 * Formula per deal: (deal.valueMinor * BigInt(stageProbability)) / 100n
 *
 * Validates: Requirements 8.4
 */

export interface DealForForecast {
  id: string;
  stageId: string;
  valueMinor: bigint;
}

/**
 * Computes the weighted revenue forecast for a set of active deals.
 *
 * For each deal, the weighted value is:
 *   (deal.valueMinor * BigInt(stageProbability)) / 100n
 *
 * Uses bigint floor division (truncation toward zero) — never loses precision.
 *
 * @param deals — active deals with stageId and valueMinor (bigint paise)
 * @param stageProbabilities — map of stageId → probability (0–100 integer)
 * @returns total weighted forecast as bigint paise
 */
export function weightedForecast(
  deals: DealForForecast[],
  stageProbabilities: Map<string, number>,
): bigint {
  let total = 0n;

  for (const deal of deals) {
    const probability = stageProbabilities.get(deal.stageId) ?? 0;
    // Clamp probability to valid range 0–100
    const clampedProb = Math.max(0, Math.min(100, Math.round(probability)));
    const weighted = (deal.valueMinor * BigInt(clampedProb)) / 100n;
    total += weighted;
  }

  return total;
}

/**
 * Computes per-stage breakdown of weighted revenue forecast.
 *
 * @returns Map of stageId → weighted total (bigint paise)
 */
export function weightedForecastByStage(
  deals: DealForForecast[],
  stageProbabilities: Map<string, number>,
): Map<string, bigint> {
  const result = new Map<string, bigint>();

  for (const deal of deals) {
    const probability = stageProbabilities.get(deal.stageId) ?? 0;
    const clampedProb = Math.max(0, Math.min(100, Math.round(probability)));
    const weighted = (deal.valueMinor * BigInt(clampedProb)) / 100n;
    const current = result.get(deal.stageId) ?? 0n;
    result.set(deal.stageId, current + weighted);
  }

  return result;
}
