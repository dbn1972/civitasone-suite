/**
 * Revenue Analytics + Forecasting — pure domain functions (SVC-140).
 *
 * ALL money is bigint paise; ratios are integer basis points (bps, 1% = 100 bps).
 * NO floating-point arithmetic touches a money value — projections use exact
 * bigint integer division (deterministic, reproducible). Only derived
 * dimensionless KPIs (confidence/efficiency in bps) are surfaced as JS numbers.
 *
 * _Requirements: SVC-140 (Revenue analytics and forecasting)_
 */

export class DomainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

// ── Analytics aggregation ──────────────────────────────────────────────────────

export type DcbEntryType = "demand" | "collection" | "refund" | "adjustment" | "write_off";

export interface PeriodDcbEntry {
  /** Period bucket key, e.g. "2024-04" (month) or "2024-2025" (FY). */
  period: string;
  entryType: DcbEntryType;
  amountMinor: bigint;
}

export interface PeriodTrend {
  period: string;
  demandMinor: bigint;
  collectionMinor: bigint;
  /** collection / demand in basis points (10000 = 100%). */
  efficiencyBps: number;
}

/**
 * Collection efficiency = collected / demanded, in basis points.
 * Returns 0 when there is no demand. May exceed 10000 when over-collected
 * (e.g. arrears cleared in a later period) — surfaced as-is, not clamped.
 */
export function collectionEfficiencyBps(demandMinor: bigint, collectionMinor: bigint): number {
  if (demandMinor <= 0n) return 0;
  return Number((collectionMinor * 10000n) / demandMinor);
}

/**
 * Aggregate raw DCB entries into per-period demand vs collection totals.
 * `demand` entries add to demand; every other entry type is treated as a
 * balance-reducing collection-side flow (mirrors assessment.computeDcbSummary).
 * Output is sorted ascending by period key for deterministic series ordering.
 */
export function aggregatePeriodSeries(entries: PeriodDcbEntry[]): PeriodTrend[] {
  const byPeriod = new Map<string, { demand: bigint; collection: bigint }>();

  for (const e of entries) {
    const bucket = byPeriod.get(e.period) ?? { demand: 0n, collection: 0n };
    if (e.entryType === "demand") bucket.demand += e.amountMinor;
    else bucket.collection += e.amountMinor;
    byPeriod.set(e.period, bucket);
  }

  return [...byPeriod.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([period, v]) => ({
      period,
      demandMinor: v.demand,
      collectionMinor: v.collection,
      efficiencyBps: collectionEfficiencyBps(v.demand, v.collection),
    }));
}

export interface DefaulterRow {
  assesseeId: string;
  outstandingMinor: bigint;
}

export interface RankedDefaulter extends DefaulterRow {
  rank: number;
}

/**
 * Rank assessees by outstanding balance (descending). Non-positive balances
 * are excluded. Ties break on assesseeId (ascending) for deterministic output.
 */
export function rankDefaulters(rows: DefaulterRow[], limit: number): RankedDefaulter[] {
  return rows
    .filter((r) => r.outstandingMinor > 0n)
    .sort((a, b) => {
      if (a.outstandingMinor !== b.outstandingMinor) return a.outstandingMinor > b.outstandingMinor ? -1 : 1;
      return a.assesseeId < b.assesseeId ? -1 : a.assesseeId > b.assesseeId ? 1 : 0;
    })
    .slice(0, Math.max(0, limit))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

// ── Forecasting ────────────────────────────────────────────────────────────────

export type ForecastMethod = "moving_average" | "straight_line" | "seasonal_naive";

export interface ForecastProjection {
  /** Zero-based index into the extended series (>= history length). */
  index: number;
  projectionMinor: bigint;
  lowerMinor: bigint;
  upperMinor: bigint;
}

export interface ForecastResult {
  method: ForecastMethod;
  historyPeriods: number;
  horizon: number;
  /** Mean absolute in-sample residual (paise) — the variance/error band width. */
  madMinor: bigint;
  /** Model confidence in basis points: 10000 - MAD/mean, clamped to [0, 10000]. */
  confidenceBps: number;
  projections: ForecastProjection[];
}

/** Floor-division mean of a bigint slice (integer paise, no float). */
function bigintMean(values: bigint[]): bigint {
  if (values.length === 0) return 0n;
  let sum = 0n;
  for (const v of values) sum += v;
  return sum / BigInt(values.length);
}

/** Absolute value for bigint. */
function babs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

interface RegCoeffs {
  sumY: bigint;
  sumI: bigint;
  denom: bigint;
  slopeNum: bigint;
}

/** Least-squares coefficients over indices 0..n-1. denom = 0 when n < 2. */
function regressionCoeffs(series: bigint[]): RegCoeffs {
  const n = series.length;
  const N = BigInt(n);
  let sumY = 0n;
  let sumI = 0n;
  let sumI2 = 0n;
  let sumIY = 0n;
  for (let i = 0; i < n; i++) {
    const bi = BigInt(i);
    sumY += series[i]!;
    sumI += bi;
    sumI2 += bi * bi;
    sumIY += bi * series[i]!;
  }
  const denom = N * sumI2 - sumI * sumI;
  const slopeNum = N * sumIY - sumI * sumY;
  return { sumY, sumI, denom, slopeNum };
}

/**
 * Regression value at index x:
 *   y(x) = (sumY*denom + slopeNum*(x*n - sumI)) / (n*denom)
 * Exact bigint (truncating) division. Falls back to the mean when denom = 0.
 */
function regressionAt(x: number, n: number, sumY: bigint, sumI: bigint, denom: bigint, slopeNum: bigint): bigint {
  const N = BigInt(n);
  if (denom === 0n) return N === 0n ? 0n : sumY / N;
  const num = sumY * denom + slopeNum * (BigInt(x) * N - sumI);
  return num / (N * denom);
}

/**
 * In-sample fitted values for a method, indexed the same as `series`.
 * Positions with no defined fit are `null` (excluded from residual stats).
 */
function fittedValues(series: bigint[], method: ForecastMethod, param: number): (bigint | null)[] {
  const n = series.length;
  const fitted: (bigint | null)[] = new Array(n).fill(null);

  if (method === "moving_average") {
    const w = param;
    for (let i = w; i < n; i++) fitted[i] = bigintMean(series.slice(i - w, i));
  } else if (method === "seasonal_naive") {
    const s = param;
    for (let i = s; i < n; i++) fitted[i] = series[i - s]!;
  } else {
    const { sumY, sumI, denom, slopeNum } = regressionCoeffs(series);
    for (let i = 0; i < n; i++) fitted[i] = regressionAt(i, n, sumY, sumI, denom, slopeNum);
  }

  return fitted;
}

/** Clamp a projected money value to be non-negative (revenue floor). */
function clampNonNeg(x: bigint): bigint {
  return x < 0n ? 0n : x;
}

/**
 * Deterministic revenue projection over a historical collection series.
 *
 * @param series   historical values (paise), oldest -> newest, length >= 2
 * @param method   projection technique
 * @param horizon  number of future periods to project (>= 1)
 * @param param    method knob: MA window / seasonal cycle length (default 3)
 */
export function forecast(
  series: bigint[],
  method: ForecastMethod,
  horizon: number,
  param = 3,
): ForecastResult {
  const n = series.length;
  if (n < 2) throw new DomainError("INSUFFICIENT_HISTORY", "forecast requires at least 2 historical periods");
  if (horizon < 1) throw new DomainError("INVALID_HORIZON", "horizon must be >= 1");
  if (method === "moving_average" || method === "seasonal_naive") {
    if (param < 1) throw new DomainError("INVALID_PARAM", "window/season length must be >= 1");
    if (param > n) throw new DomainError("INVALID_PARAM", "window/season length exceeds history length");
  }

  // ── in-sample MAD (band width) + confidence ──────────────────────────────────
  const fitted = fittedValues(series, method, param);
  let residSum = 0n;
  let residCount = 0;
  for (let i = 0; i < n; i++) {
    const f = fitted[i];
    if (f === null || f === undefined) continue;
    residSum += babs(series[i]! - f);
    residCount++;
  }
  const madMinor = residCount === 0 ? 0n : residSum / BigInt(residCount);

  const meanY = bigintMean(series);
  const confidenceBps = meanY <= 0n ? 0 : Math.max(0, 10000 - Number((madMinor * 10000n) / meanY));

  // ── forward projection ───────────────────────────────────────────────────────
  const work = [...series];
  const projections: ForecastProjection[] = [];
  const reg = method === "straight_line" ? regressionCoeffs(series) : null;

  for (let k = 0; k < horizon; k++) {
    let proj: bigint;
    if (method === "moving_average") {
      proj = bigintMean(work.slice(work.length - param));
    } else if (method === "seasonal_naive") {
      proj = work[work.length - param]!;
    } else {
      proj = regressionAt(work.length, n, reg!.sumY, reg!.sumI, reg!.denom, reg!.slopeNum);
    }
    proj = clampNonNeg(proj);
    projections.push({
      index: work.length,
      projectionMinor: proj,
      lowerMinor: clampNonNeg(proj - madMinor),
      upperMinor: proj + madMinor,
    });
    work.push(proj);
  }

  return { method, historyPeriods: n, horizon, madMinor, confidenceBps, projections };
}
