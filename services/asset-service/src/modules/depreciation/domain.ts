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

