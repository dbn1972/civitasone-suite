export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export type DepMethod = "SLM" | "WDV";

export interface SlmInput {
  acquisitionCostMinor: bigint;
  salvageValueMinor:    bigint;
  usefulLifeYears:      number;
}

/** SLM monthly depreciation: (cost - salvage) / life_years / 12 */
export function slmMonthlyAmount(input: SlmInput): bigint {
  const depreciable = input.acquisitionCostMinor - input.salvageValueMinor;
  if (depreciable <= 0n) return 0n;
  return depreciable / BigInt(input.usefulLifeYears) / 12n;
}

export interface WdvInput {
  bookValueMinor: bigint;
  ratePercent:    number;
}

/** WDV monthly depreciation: book_value * rate% / 12 */
export function wdvMonthlyAmount(input: WdvInput): bigint {
  if (input.bookValueMinor <= 0n) return 0n;
  return (input.bookValueMinor * BigInt(Math.round(input.ratePercent * 100))) / 120000n;
}

export function computeMonthlyDep(
  method: DepMethod,
  costMinor: bigint,
  salvageMinor: bigint,
  bookValueMinor: bigint,
  usefulLifeYears: number,
  ratePercent: number
): bigint {
  if (method === "SLM") {
    return slmMonthlyAmount({ acquisitionCostMinor: costMinor, salvageValueMinor: salvageMinor, usefulLifeYears });
  }
  return wdvMonthlyAmount({ bookValueMinor, ratePercent });
}

/** Compute all monthly periods from startDate to endDate (format YYYY-MM). */
export function generatePeriods(startDate: string, endDate: string): string[] {
  const periods: string[] = [];
  const [sy, sm] = startDate.slice(0, 7).split("-").map(Number) as [number, number];
  const [ey, em] = endDate.slice(0, 7).split("-").map(Number) as [number, number];
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    periods.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return periods;
}

export interface AssetHeadlineFigures {
  acquisitionCostMinor: bigint;
  salvageValueMinor:    bigint;
  accumulatedDepMinor:  bigint;
}

export interface BookValuePosting {
  bookValueMinor:       bigint;
  accumulatedDepMinor:  bigint;
}

/**
 * Compute an asset's new headline `bookValue`/`accumulatedDep` after posting
 * one depreciation-schedule entry, deriving bookValue directly from the
 * updated accumulatedDep so the two figures can never disagree.
 *
 * Bug this replaces (found live in a deep-verify pass, 2026-08-27): the
 * depreciation-run consumer used to copy the schedule entry's own
 * `bookValueAfterMinor` — a value baked in at schedule-GENERATION time that
 * assumes every prior period in the schedule was already posted in
 * chronological order — straight onto the asset row's `bookValue`, while
 * separately computing `accumulatedDep` as a running sum of only the
 * entries ACTUALLY posted so far. The two update paths agree only when
 * periods post in perfect, gap-free order. The instant a period is posted
 * late, out of order, or a period is skipped (a scheduler outage, a manual
 * catch-up run, a period run twice for different books), `bookValue` and
 * `accumulatedDep` silently disagree on the same row — reproduced live:
 * asset bc24a403-3961-449e-ad1f-e889e575e9f3 (acquisitionCost 8500000,
 * SLM, 60 monthly entries of 133333) had only its Apr+May "company"-book
 * entries posted (accumulatedDep correctly = 266666) while bookValue was
 * 7833335 — the value from a schedule entry computed as if Jan/Feb/Mar had
 * ALSO already been posted (5 periods x 133333 = 666665 implied), i.e.
 * `acquisitionCost - accumulatedDep` (8233334) no longer equalled
 * `bookValue` (7833335) on the same row, a real ledger-integrity bug on a
 * headline financial figure.
 */
export function applyDepreciationPosting(
  asset: AssetHeadlineFigures,
  entryAmountMinor: bigint,
): BookValuePosting {
  const accumulatedDepMinor = asset.accumulatedDepMinor + entryAmountMinor;
  let bookValueMinor = asset.acquisitionCostMinor - accumulatedDepMinor;
  if (bookValueMinor < asset.salvageValueMinor) bookValueMinor = asset.salvageValueMinor;
  return { bookValueMinor, accumulatedDepMinor };
}
