/**
 * Pure helpers for the CRM revenue forecast screen.
 *
 * The crm-service forecast endpoint returns a weighted total plus a per-stage
 * breakdown, both as bigint paise strings. Everything that turns that payload
 * into something presentable lives here so it can be tested without rendering.
 */
import type { CRMForecast, CRMForecastStage } from "@civitasone/types";

export type ProbabilityBand = "low" | "medium" | "high";

export interface RankedForecastStage extends CRMForecastStage {
  /** Share of the weighted total contributed by this stage, to two decimals. */
  sharePct: number;
  band: ProbabilityBand;
}

/**
 * Share of the weighted total attributable to one stage.
 *
 * Computed in bigint space and only narrowed to a number at the end: pipeline
 * totals run to crores of paise, and a float division there loses rupees.
 */
export function stageSharePct(weightedTotalMinor: string, totalForecastMinor: string): number {
  let weighted: bigint;
  let total: bigint;
  try {
    weighted = BigInt(weightedTotalMinor || "0");
    total = BigInt(totalForecastMinor || "0");
  } catch {
    return 0;
  }
  if (total <= 0n) return 0;
  // Scale by 10000 so the result carries two decimal places after /100.
  return Number((weighted * 10000n) / total) / 100;
}

/**
 * A stage's probability expressed as a coarse band, used to colour the row.
 * Thresholds live here rather than inline in JSX so the "what counts as a
 * likely stage" decision is reviewable and testable in one place.
 */
export function probabilityBand(probability: number): ProbabilityBand {
  if (probability >= 70) return "high";
  if (probability >= 30) return "medium";
  return "low";
}

/**
 * Orders the stage breakdown by contribution, largest first, and annotates each
 * row with its share and probability band. Ties fall back to stage name so the
 * table order is stable across reloads.
 */
export function rankStages(forecast: CRMForecast): RankedForecastStage[] {
  return forecast.stages
    .map((stage) => ({
      ...stage,
      sharePct: stageSharePct(stage.weightedTotalMinor, forecast.totalForecastMinor),
      band: probabilityBand(stage.probability),
    }))
    .sort((a, b) => {
      if (b.sharePct !== a.sharePct) return b.sharePct - a.sharePct;
      return a.stageName.localeCompare(b.stageName);
    });
}

/**
 * The single stage contributing the most weighted revenue, or null when the
 * forecast is empty. Drives the headline "biggest contributor" stat.
 */
export function topContributingStage(forecast: CRMForecast): RankedForecastStage | null {
  const ranked = rankStages(forecast);
  return ranked.length > 0 ? ranked[0] : null;
}

/**
 * Average deal value inside the forecast, in paise, as a bigint string.
 * Returns "0" when there are no deals rather than dividing by zero.
 */
export function averageWeightedDealMinor(forecast: CRMForecast): string {
  if (forecast.dealCount <= 0) return "0";
  try {
    return (BigInt(forecast.totalForecastMinor || "0") / BigInt(forecast.dealCount)).toString();
  } catch {
    return "0";
  }
}
