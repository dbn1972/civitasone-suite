/**
 * SVC-039 — Budget monitoring & forecasting pure domain.
 *
 * Computes availability, burn rate, straight-line year-end forecast and
 * exception classification over an allocation's allocated / committed /
 * expenditure figures and the fraction of the financial year elapsed.
 * All money is BigInt paise; ratios are integer basis points (no float on money).
 * No DB, no HTTP, no queue.
 */
import { DomainError } from "./domain.js";

const BPS = 10_000n;
const MS_PER_DAY = 86_400_000;

export type ExceptionKind = "on_track" | "over_committed" | "projected_overspend" | "under_utilised";

export interface MonitorLine {
  allocatedMinor: bigint;
  committedMinor: bigint;
  actualMinor: bigint;   // expenditure to date
}

/** Available appropriation = allocated − (committed + actual). */
export function availableMinor(l: MonitorLine): bigint {
  return l.allocatedMinor - (l.committedMinor + l.actualMinor);
}

/** Burn rate in basis points = expenditure / allocation (uncapped; can exceed 100%). */
export function burnRateBps(allocatedMinor: bigint, actualMinor: bigint): bigint {
  if (allocatedMinor <= 0n) return 0n;
  return (actualMinor * BPS) / allocatedMinor;
}

/** Commitment coverage in basis points = (committed + actual) / allocation. */
export function utilisationBps(l: MonitorLine): bigint {
  if (l.allocatedMinor <= 0n) return 0n;
  return ((l.committedMinor + l.actualMinor) * BPS) / l.allocatedMinor;
}

/**
 * Inclusive Indian financial-year bounds for "YYYY-YY": 1 Apr YYYY .. 31 Mar
 * YYYY+1 (UTC). Throws on a malformed FY.
 */
export function fyBounds(fy: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}$/.test(fy)) {
    throw new DomainError("INVALID_FY", `fiscal year must be YYYY-YY, got '${fy}'`);
  }
  const startYear = Number(fy.slice(0, 4));
  const start = new Date(Date.UTC(startYear, 3, 1));            // 1 Apr
  const end = new Date(Date.UTC(startYear + 1, 2, 31));         // 31 Mar next year
  return { start, end };
}

/**
 * Fraction of the FY elapsed as of `asOf`, in basis points [0, 10000]. Before
 * the FY starts → 0; on/after the last day → 10000.
 */
export function fractionElapsedBps(fy: string, asOf: Date): bigint {
  const { start, end } = fyBounds(fy);
  const totalDays = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1; // inclusive
  const elapsedDays = Math.floor((asOf.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  if (elapsedDays <= 0) return 0n;
  if (elapsedDays >= totalDays) return BPS;
  return (BigInt(elapsedDays) * BPS) / BigInt(totalDays);
}

/**
 * Straight-line year-end expenditure forecast: project the current spend across
 * the full year given the fraction elapsed. Returns the current spend unchanged
 * when no time has elapsed (cannot extrapolate yet).
 */
export function forecastYearEndMinor(actualMinor: bigint, elapsedBps: bigint): bigint {
  if (elapsedBps <= 0n) return actualMinor;
  return (actualMinor * BPS) / elapsedBps;
}

export interface ExceptionOptions {
  /** How far below the elapsed pace counts as under-utilisation (bps). Default 2500 (25%). */
  underUtilGapBps?: bigint;
}

/**
 * Classify a monitored line into an exception bucket:
 *  - over_committed:      committed + actual already exceeds the allocation (available < 0)
 *  - projected_overspend: straight-line year-end forecast exceeds the allocation
 *  - under_utilised:      burn rate lags the elapsed pace by more than the gap
 *  - on_track:            none of the above
 */
export function classifyException(l: MonitorLine, elapsedBps: bigint, opts: ExceptionOptions = {}): ExceptionKind {
  const gap = opts.underUtilGapBps ?? 2_500n;
  if (availableMinor(l) < 0n) return "over_committed";
  const forecast = forecastYearEndMinor(l.actualMinor, elapsedBps);
  if (forecast > l.allocatedMinor) return "projected_overspend";
  const burn = burnRateBps(l.allocatedMinor, l.actualMinor);
  if (elapsedBps > 0n && burn + gap < elapsedBps) return "under_utilised";
  return "on_track";
}

export interface PortfolioTotals {
  count: number;
  allocatedMinor: bigint;
  committedMinor: bigint;
  actualMinor: bigint;
  availableMinor: bigint;
  forecastYearEndMinor: bigint;
  exceptions: Record<ExceptionKind, number>;
}

/** Aggregate a set of monitored lines into portfolio totals + exception counts. */
export function summarisePortfolio(lines: MonitorLine[], elapsedBps: bigint, opts: ExceptionOptions = {}): PortfolioTotals {
  const totals: PortfolioTotals = {
    count: lines.length,
    allocatedMinor: 0n, committedMinor: 0n, actualMinor: 0n,
    availableMinor: 0n, forecastYearEndMinor: 0n,
    exceptions: { on_track: 0, over_committed: 0, projected_overspend: 0, under_utilised: 0 },
  };
  for (const l of lines) {
    totals.allocatedMinor += l.allocatedMinor;
    totals.committedMinor += l.committedMinor;
    totals.actualMinor += l.actualMinor;
    totals.availableMinor += availableMinor(l);
    totals.forecastYearEndMinor += forecastYearEndMinor(l.actualMinor, elapsedBps);
    totals.exceptions[classifyException(l, elapsedBps, opts)] += 1;
  }
  return totals;
}
