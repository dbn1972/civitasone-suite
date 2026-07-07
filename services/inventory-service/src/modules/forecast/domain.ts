/**
 * Demand Forecasting — Domain Logic (Pure Functions)
 *
 * Computes safety stock, reorder point, and simple moving average (SMA) fallback
 * for items that lack a trained exponential-smoothing model from ml-service.
 *
 * Safety stock formula: stdDev90d × serviceLevel_Z (Z = 1.645 for 95%)
 * Reorder point: avgDailyMovement × leadTimeDays + safetyStock
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8
 */

/** Z-score for 95% service level — default. */
export const SERVICE_LEVEL_Z = 1.645;

/** Minimum number of movement records needed for a forecast. */
export const MIN_MOVEMENT_RECORDS = 30;

/** Allowed horizon values. */
export const VALID_HORIZONS = [30, 60, 90] as const;
export type Horizon = (typeof VALID_HORIZONS)[number];

export interface MovementRecord {
  date: string; // ISO date (YYYY-MM-DD)
  qty: number;  // unsigned daily movement quantity
}

export interface ForecastFeatures {
  avgDailyMovement30d: number;
  avgDailyMovement90d: number;
  stdDevMovement90d: number;
  leadTimeDays: number;
  seasonalityIndex: number;
}

export interface DemandForecastResult {
  dailyForecast: number[];
  totalDemand: number;
  safetyStock: number;
  reorderPoint: number;
  confidence: number;
}

export interface InsufficientDataResult {
  forecast: null;
  reason: "insufficient_data";
}

export type ForecastResponse = DemandForecastResult | InsufficientDataResult;

/**
 * Compute safety stock: stdDev × Z-score (95% service level by default).
 */
export function computeSafetyStock(stdDev90d: number, zScore: number = SERVICE_LEVEL_Z): number {
  return Math.ceil(stdDev90d * zScore);
}

/**
 * Compute reorder point: avgDailyMovement × leadTimeDays + safetyStock.
 */
export function computeReorderPoint(avgDailyMovement: number, leadTimeDays: number, safetyStock: number): number {
  return Math.ceil(avgDailyMovement * leadTimeDays + safetyStock);
}

/**
 * Determine whether demand within lead-time crosses the reorder point.
 * Returns true if forecast demand within leadTimeDays exceeds reorder threshold.
 */
export function shouldReorder(
  dailyForecast: number[],
  leadTimeDays: number,
  currentOnHand: number,
  reorderPoint: number,
): boolean {
  const leadTimeDemand = dailyForecast.slice(0, leadTimeDays).reduce((s, v) => s + v, 0);
  const projectedStock = currentOnHand - leadTimeDemand;
  return projectedStock <= reorderPoint;
}

/**
 * Compute features from raw movement records (past 90 days preferred, minimum 30).
 */
export function computeFeatures(movements: MovementRecord[], leadTimeDays: number): ForecastFeatures {
  const n = movements.length;
  if (n === 0) {
    return { avgDailyMovement30d: 0, avgDailyMovement90d: 0, stdDevMovement90d: 0, leadTimeDays, seasonalityIndex: 1.0 };
  }

  // Sort by date descending for recency slicing
  const sorted = [...movements].sort((a, b) => b.date.localeCompare(a.date));

  const last30 = sorted.slice(0, Math.min(30, n));
  const last90 = sorted.slice(0, Math.min(90, n));

  const avg30 = last30.reduce((s, r) => s + r.qty, 0) / last30.length;
  const avg90 = last90.reduce((s, r) => s + r.qty, 0) / last90.length;

  // Standard deviation of the 90-day window
  const mean90 = avg90;
  const variance90 = last90.reduce((s, r) => s + (r.qty - mean90) ** 2, 0) / last90.length;
  const stdDev90 = Math.sqrt(variance90);

  // Simple seasonality index: ratio of recent 30d avg to 90d avg (>1 means increasing demand)
  const seasonalityIndex = avg90 > 0 ? avg30 / avg90 : 1.0;

  return {
    avgDailyMovement30d: avg30,
    avgDailyMovement90d: avg90,
    stdDevMovement90d: stdDev90,
    leadTimeDays,
    seasonalityIndex,
  };
}

/**
 * Simple Moving Average (SMA) fallback forecast when no trained model exists.
 * Produces a flat daily forecast based on the 90-day average demand, adjusted by seasonality.
 */
export function smaFallbackForecast(features: ForecastFeatures, horizon: Horizon): DemandForecastResult {
  const adjustedDailyDemand = features.avgDailyMovement90d * features.seasonalityIndex;
  const dailyForecast = Array.from({ length: horizon }, () => Math.max(0, Math.round(adjustedDailyDemand * 100) / 100));
  const totalDemand = Math.round(dailyForecast.reduce((s, v) => s + v, 0));
  const safetyStock = computeSafetyStock(features.stdDevMovement90d);
  const reorderPoint = computeReorderPoint(features.avgDailyMovement90d, features.leadTimeDays, safetyStock);

  // Confidence is lower for SMA fallback — set to 0.40 (amber zone)
  const confidence = 0.40;

  return { dailyForecast, totalDemand, safetyStock, reorderPoint, confidence };
}

/**
 * Validates the horizon parameter.
 */
export function isValidHorizon(h: unknown): h is Horizon {
  return typeof h === "number" && VALID_HORIZONS.includes(h as Horizon);
}
