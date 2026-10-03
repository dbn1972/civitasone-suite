/**
 * GAP-HR-LEAVE-APPLY-05: LOP-day arithmetic that understands half-day leave.
 *
 * Whole-day leave keeps the historical behaviour byte-for-byte: the LOP day
 * count is rounded to a whole day (a 3-day half-pay leave -> 1.5 -> 2). A
 * part-day leave (hrms-service sends daysExact = 0.5 and dayPart != 'full')
 * must NOT be rounded up to a whole LOP day -- half a day of unpaid leave is
 * half a day of LOP -- so it is carried to two decimals (0.5 day at 5000 bps
 * = 0.25 day).
 */
export interface LeaveApprovedLopInput {
  daysApplied: number;
  daysExact?: number;
  dayPart?: string;
}

export function leaveLopDays(p: LeaveApprovedLopInput, lopFractionBps: number): number {
  const isPartDay = (p.dayPart != null && p.dayPart !== "full")
    || (p.daysExact != null && !Number.isInteger(p.daysExact));
  if (isPartDay) {
    const days = p.daysExact ?? p.daysApplied;
    return Math.round((days * lopFractionBps) / 100) / 100;
  }
  return Math.round((p.daysApplied * lopFractionBps) / 10000);
}

/** LOP days -> integer hundredths, so bigint money maths stays exact. */
export function lopDaysToHundredths(lopDays: number): bigint {
  return BigInt(Math.round(lopDays * 100));
}

/**
 * Loss-of-pay deduction for `lopDays` days (may be fractional) out of a month
 * of `daysInMonth`. Multiply before dividing; for a whole-day count this is
 * algebraically identical to the historical `(base * BigInt(lopDays)) / daysInMonth`.
 */
export function lopDeductionMinor(baseMinor: bigint, lopDays: number, daysInMonth: bigint): bigint {
  return (baseMinor * lopDaysToHundredths(lopDays)) / (daysInMonth * 100n);
}

/** Pay left after pro-rating out `lopDays` days (consolidated-pay pro-ration): base * (D - lop) / D. */
export function proratedPayMinor(baseMinor: bigint, lopDays: number, daysInMonth: bigint): bigint {
  return (baseMinor * (daysInMonth * 100n - lopDaysToHundredths(lopDays))) / (daysInMonth * 100n);
}
