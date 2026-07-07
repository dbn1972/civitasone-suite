/**
 * Holt-Winters Exponential Smoothing for Time-Series Forecasting
 *
 * Supports:
 * - Simple exponential smoothing (flat series)
 * - Double exponential smoothing / Holt's linear trend (trending-only)
 * - Triple exponential smoothing / Holt-Winters additive (seasonal)
 *
 * Auto-detects seasonality from 12-month historical data via autocorrelation.
 * All forecasted values are floored at 0 (demand-type series assumption).
 *
 * Requirements: 8.2, 8.3
 */

export interface ExponentialSmoothingModel {
  type: "exponential_smoothing";
  alpha: number; // level smoothing
  beta: number; // trend smoothing
  gamma?: number; // seasonal smoothing
  seasonalPeriod?: number;
  lastLevel: number;
  lastTrend: number;
  seasonalFactors?: number[];
}

/**
 * Detect seasonality period from a time series using autocorrelation on de-trended residuals.
 * De-trends the series first (removes linear trend) to avoid false positives from trending data.
 * Analyzes lag values from 2 to maxLag looking for repeating patterns.
 * Returns the lag with the highest significant autocorrelation, or undefined if none found.
 */
export function detectSeasonality(
  series: number[],
  maxLag?: number,
): number | undefined {
  const n = series.length;
  // Need at least 2 full cycles of the shortest candidate period (lag=2)
  if (n < 6) return undefined;

  // De-trend the series using linear regression to remove trend effects
  const detrended = detrendSeries(series);

  const effectiveMaxLag = Math.min(maxLag ?? Math.floor(n / 2), Math.floor(n / 2));

  // Compute mean and variance of de-trended series
  const mean = detrended.reduce((s, v) => s + v, 0) / n;
  const variance = detrended.reduce((s, v) => s + (v - mean) ** 2, 0) / n;

  // Zero or near-zero variance after de-trending means no seasonality
  if (variance < 1e-10) return undefined;

  let bestLag: number | undefined;
  let bestCorrelation = 0;
  const significanceThreshold = 0.3; // Minimum autocorrelation to consider seasonal

  for (let lag = 2; lag <= effectiveMaxLag; lag++) {
    // Need at least 2 full cycles
    if (n < lag * 2) continue;

    let autoCorrelation = 0;
    for (let i = 0; i < n - lag; i++) {
      autoCorrelation += (detrended[i]! - mean) * (detrended[i + lag]! - mean);
    }
    autoCorrelation /= (n - lag) * variance;

    if (autoCorrelation > significanceThreshold && autoCorrelation > bestCorrelation) {
      bestCorrelation = autoCorrelation;
      bestLag = lag;
    }
  }

  return bestLag;
}

/**
 * Remove linear trend from a series via least-squares regression.
 * Returns residuals (original - fitted linear trend).
 */
function detrendSeries(series: number[]): number[] {
  const n = series.length;
  if (n <= 1) return [...series];

  // Compute linear regression: y = slope * x + intercept
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += series[i]!;
    sumXY += i * series[i]!;
    sumXX += i * i;
  }

  const denominator = n * sumXX - sumX * sumX;
  // Avoid division by zero (shouldn't happen with n > 1)
  if (Math.abs(denominator) < 1e-15) return [...series];

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  // Subtract trend to get residuals
  const residuals: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    residuals[i] = series[i]! - (slope * i + intercept);
  }

  return residuals;
}

/**
 * Initialize seasonal factors for Holt-Winters using the first few complete cycles.
 * Uses additive decomposition: seasonal[i] = average(values at position i) - overall level.
 */
function initializeSeasonalFactors(series: number[], period: number): number[] {
  const numCycles = Math.floor(series.length / period);
  const factors: number[] = new Array(period).fill(0);

  // Compute average for each seasonal position across all complete cycles
  for (let i = 0; i < period; i++) {
    let sum = 0;
    let count = 0;
    for (let cycle = 0; cycle < numCycles; cycle++) {
      const idx = cycle * period + i;
      if (idx < series.length) {
        sum += series[idx]!;
        count++;
      }
    }
    factors[i] = count > 0 ? sum / count : 0;
  }

  // Normalize: subtract mean so factors sum to ~0 (additive model)
  const factorMean = factors.reduce((s, v) => s + v, 0) / period;
  for (let i = 0; i < period; i++) {
    factors[i] = factors[i]! - factorMean;
  }

  return factors;
}

/**
 * Compute the variance of a numeric series.
 */
function computeVariance(series: number[]): number {
  if (series.length === 0) return 0;
  const mean = series.reduce((s, v) => s + v, 0) / series.length;
  return series.reduce((s, v) => s + (v - mean) ** 2, 0) / series.length;
}

/**
 * Fit an exponential smoothing model to the given time series.
 *
 * - If seasonalPeriod is provided and series has >= 2 full cycles, uses Holt-Winters (triple).
 * - If no seasonalPeriod provided, auto-detects from data.
 * - Falls back to Holt's linear trend (double) if no seasonality found or insufficient data.
 *
 * Edge cases:
 * - Flat series (zero variance): returns model with lastLevel = last value, zero trend
 * - Insufficient data (< 3 points): returns model with lastLevel = mean, zero trend
 * - Trending-only (no seasonal): alpha + beta only, gamma = 0
 *
 * @param series - Array of numeric observations (equally spaced in time)
 * @param seasonalPeriod - Optional known seasonal period (e.g., 12 for monthly with annual cycle)
 */
export function fitExponentialSmoothing(
  series: number[],
  seasonalPeriod?: number,
): ExponentialSmoothingModel {
  // Edge case: insufficient data
  if (series.length < 3) {
    const mean = series.length > 0
      ? series.reduce((s, v) => s + v, 0) / series.length
      : 0;
    return {
      type: "exponential_smoothing",
      alpha: 0.3,
      beta: 0,
      lastLevel: mean,
      lastTrend: 0,
    };
  }

  // Edge case: flat series (zero variance)
  const variance = computeVariance(series);
  if (variance === 0) {
    return {
      type: "exponential_smoothing",
      alpha: 1.0,
      beta: 0,
      lastLevel: series[series.length - 1]!,
      lastTrend: 0,
    };
  }

  // Determine seasonal period
  let detectedPeriod = seasonalPeriod;
  if (detectedPeriod === undefined) {
    detectedPeriod = detectSeasonality(series);
  }

  // Use Holt-Winters if we have a seasonal period AND enough data (>= 2 full cycles)
  const useSeasonal = detectedPeriod !== undefined && series.length >= detectedPeriod * 2;

  if (useSeasonal) {
    return fitHoltWinters(series, detectedPeriod!);
  }

  // Fall back to Holt's linear trend (double exponential smoothing)
  return fitHoltLinear(series);
}

/**
 * Holt's linear trend method (double exponential smoothing).
 * Models level + trend without seasonality.
 */
function fitHoltLinear(series: number[]): ExponentialSmoothingModel {
  const alpha = 0.3;
  const beta = 0.1;

  // Initialize: level = first value, trend = average of first few differences
  let level = series[0]!;
  const trendSamples = Math.min(series.length - 1, 5);
  let trend = 0;
  for (let i = 0; i < trendSamples; i++) {
    trend += series[i + 1]! - series[i]!;
  }
  trend /= trendSamples;

  // Iterate through series to update level and trend
  for (let i = 1; i < series.length; i++) {
    const value = series[i]!;
    const prevLevel = level;

    level = alpha * value + (1 - alpha) * (prevLevel + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }

  return {
    type: "exponential_smoothing",
    alpha,
    beta,
    lastLevel: level,
    lastTrend: trend,
  };
}

/**
 * Holt-Winters additive method (triple exponential smoothing).
 * Models level + trend + additive seasonal component.
 */
function fitHoltWinters(series: number[], period: number): ExponentialSmoothingModel {
  const alpha = 0.3;
  const beta = 0.1;
  const gamma = 0.3;

  // Initialize seasonal factors from first cycles
  const seasonalFactors = initializeSeasonalFactors(series, period);

  // Initialize level as mean of first cycle
  let level = 0;
  for (let i = 0; i < period; i++) {
    level += series[i]!;
  }
  level /= period;

  // Initialize trend as average difference between first two cycles
  let trend = 0;
  if (series.length >= period * 2) {
    for (let i = 0; i < period; i++) {
      trend += (series[i + period]! - series[i]!) / period;
    }
    trend /= period;
  }

  // Run through the series updating level, trend, and seasonal factors
  for (let i = 0; i < series.length; i++) {
    const value = series[i]!;
    const seasonIdx = i % period;
    const seasonalValue = seasonalFactors[seasonIdx]!;
    const prevLevel = level;

    // Update level (de-seasonalized)
    level = alpha * (value - seasonalValue) + (1 - alpha) * (prevLevel + trend);
    // Update trend
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    // Update seasonal factor for this position
    seasonalFactors[seasonIdx] = gamma * (value - level) + (1 - gamma) * seasonalValue;
  }

  return {
    type: "exponential_smoothing",
    alpha,
    beta,
    gamma,
    seasonalPeriod: period,
    lastLevel: level,
    lastTrend: trend,
    seasonalFactors: [...seasonalFactors],
  };
}

/**
 * Forecast N periods ahead using a fitted exponential smoothing model.
 *
 * For Holt-Winters: forecast(h) = lastLevel + h * lastTrend + seasonal[h % period]
 * For Holt's linear: forecast(h) = lastLevel + h * lastTrend
 *
 * All values are floored at 0 (demand-type series — negative demand is nonsensical).
 *
 * @param model - A fitted ExponentialSmoothingModel
 * @param horizonDays - Number of periods (days) to forecast ahead
 * @returns Array of forecasted values, length = horizonDays
 */
export function forecast(
  model: ExponentialSmoothingModel,
  horizonDays: number,
): number[] {
  if (horizonDays <= 0) return [];

  const result: number[] = [];
  const { lastLevel, lastTrend, seasonalFactors, seasonalPeriod } = model;

  for (let h = 1; h <= horizonDays; h++) {
    let value = lastLevel + h * lastTrend;

    // Add seasonal component if Holt-Winters
    if (seasonalFactors && seasonalPeriod && seasonalPeriod > 0) {
      const seasonIdx = (h - 1) % seasonalPeriod;
      value += seasonalFactors[seasonIdx]!;
    }

    // Floor at 0 for demand-type series
    result.push(Math.max(0, value));
  }

  return result;
}
