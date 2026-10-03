/**
 * GAP-ASSETS-LEASES-07: lease liability discounting and amortisation schedule.
 *
 * Pure functions, no I/O. All amounts are integer minor units (paise) as bigint.
 * Payments are assumed to fall at the END of each period (in arrears); the
 * discount rate is the lessee's incremental borrowing rate (IBR) expressed in
 * basis points per YEAR and applied pro rata per period (nominal annual rate / periods per year).
 *
 * The last period's interest is a plug so the liability closes at exactly 0 and
 * sum(principal) === opening liability, sum(interest) === sum(payments) - liability.
 */
export type LeaseFrequency = "monthly" | "quarterly" | "annual";

export const STEP_MONTHS: Record<LeaseFrequency, number> = { monthly: 1, quarterly: 3, annual: 12 };
export const MAX_SCHEDULE_PERIODS = 600;

export type LeaseScheduleRow = {
  seq: number;
  dueDate: string; // YYYY-MM-DD, last day of the period
  openingMinor: bigint;
  interestMinor: bigint;
  paymentMinor: bigint;
  principalMinor: bigint;
  closingMinor: bigint;
};

export type LeaseSchedule = { liabilityMinor: bigint; rows: LeaseScheduleRow[]; totalInterestMinor: bigint };

const DAY_MS = 86_400_000;
const parseIso = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** Whole number of payment periods covered by [start, end] (end inclusive). */
export function schedulePeriodCount(startIso: string, endIso: string, frequency: LeaseFrequency): number {
  const days = (parseIso(endIso) - parseIso(startIso)) / DAY_MS + 1;
  const months = Math.round(days / 30.4375);
  return Math.max(1, Math.round(months / STEP_MONTHS[frequency]));
}

/** Last day of the period that ends `months` after `startIso` (i.e. start + months - 1 day). */
export function periodEndDate(startIso: string, months: number): string {
  const y = Number(startIso.slice(0, 4));
  const m = Number(startIso.slice(5, 7)) - 1;
  const d = Number(startIso.slice(8, 10));
  const first = new Date(Date.UTC(y, m + months, 1));
  // clamp the day to the target month's length, then step back one day
  const dim = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const anniv = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, dim));
  return new Date(anniv - DAY_MS).toISOString().slice(0, 10);
}

export function buildLeaseSchedule(input: {
  leaseStart: string;
  leaseEnd: string;
  paymentMinor: bigint;
  ibrBps: number;
  frequency: LeaseFrequency;
}): LeaseSchedule {
  const { leaseStart, leaseEnd, paymentMinor, ibrBps, frequency } = input;
  if (paymentMinor <= 0n) throw new Error("paymentMinor must be positive");
  if (!Number.isInteger(ibrBps) || ibrBps < 0 || ibrBps > 10_000) throw new Error("ibrBps must be an integer 0..10000");
  const n = schedulePeriodCount(leaseStart, leaseEnd, frequency);
  if (n > MAX_SCHEDULE_PERIODS) throw new Error(`lease term exceeds ${MAX_SCHEDULE_PERIODS} periods`);
  const step = STEP_MONTHS[frequency];
  const r = (ibrBps / 10_000) * (step / 12);
  // The route caps paymentMinor at Number.MAX_SAFE_INTEGER; only the discount factors are floating, and every
  // stored amount is rounded back to an integer bigint.
  const pay = Number(paymentMinor); // precision-ok

  let pv = 0;
  for (let k = 1; k <= n; k++) pv += pay / Math.pow(1 + r, k);
  const liabilityMinor = BigInt(Math.round(pv));

  const rows: LeaseScheduleRow[] = [];
  let opening = liabilityMinor;
  let totalInterest = 0n;
  for (let k = 1; k <= n; k++) {
    let interest = BigInt(Math.round(Number(opening) * r));
    if (k === n) interest = paymentMinor - opening; // plug: closes the liability at exactly 0
    // A negative interest means the terms do not amortise (a payment below the opening balance in the last period, or
    // rounding drift): refuse rather than clamp, which would break the closes-at-0 invariant.
    if (interest < 0n) throw new Error(`lease terms do not amortise to zero (negative interest in period ${k})`);
    const closing = opening + interest - paymentMinor;
    if (closing < 0n) throw new Error(`lease terms do not amortise (balance below zero in period ${k})`);
    rows.push({
      seq: k,
      dueDate: periodEndDate(leaseStart, k * step),
      openingMinor: opening,
      interestMinor: interest,
      paymentMinor,
      principalMinor: paymentMinor - interest,
      closingMinor: closing,
    });
    totalInterest += interest;
    opening = closing;
  }
  return { liabilityMinor, rows, totalInterestMinor: totalInterest };
}
