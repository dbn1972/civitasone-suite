/**
 * Apprentice stipend engine (pure). Computes the attendance-pro-rated monthly
 * stipend, the NAPS reimbursement the government pays the employer, and the net
 * employer cost. Money in paise (bigint). No PF/ESI/TDS — an apprentice stipend
 * is not salary.
 *
 * NAPS: the employer pays the apprentice the full (pro-rated) stipend; the
 * government reimburses a share of it (default 25%, capped — historically
 * ₹1,500/month) via DBT. The reimbursement is computed on the ACTUAL stipend
 * paid, then capped. Rates in basis points (2500 = 25%).
 */

/** Round-half-up of value * bps / 10000, on non-negative paise. */
export function applyBps(valueMinor: bigint, bps: number): bigint {
  if (bps <= 0 || valueMinor <= 0n) return 0n;
  return (valueMinor * BigInt(bps) + 5000n) / 10000n;
}

/** Attendance pro-rating: stipend * daysPresent / workingDays, half-up. */
export function prorate(monthlyMinor: bigint, daysPresent: number, workingDays: number): bigint {
  if (workingDays <= 0 || daysPresent <= 0 || monthlyMinor <= 0n) return 0n;
  if (daysPresent >= workingDays) return monthlyMinor;
  return (monthlyMinor * BigInt(daysPresent) + BigInt(workingDays) / 2n) / BigInt(workingDays);
}

export interface StipendInput {
  monthlyStipendMinor: bigint;
  workingDays: number;
  daysPresent: number;
  napsReimbPctBps: number;   // e.g. 2500 for 25%
  napsReimbCapMinor: bigint; // e.g. 150000 for ₹1,500
}

export interface Stipend {
  grossStipendMinor: bigint;   // pro-rated, paid to the apprentice
  napsReimbMinor: bigint;      // govt share, paid to the employer (capped)
  employerCostMinor: bigint;   // gross - reimbursement
}

export function computeStipend(i: StipendInput): Stipend {
  const grossStipendMinor = prorate(i.monthlyStipendMinor, i.daysPresent, i.workingDays);
  const uncapped = applyBps(grossStipendMinor, i.napsReimbPctBps);
  const napsReimbMinor = uncapped > i.napsReimbCapMinor ? i.napsReimbCapMinor : uncapped;
  return {
    grossStipendMinor,
    napsReimbMinor,
    employerCostMinor: grossStipendMinor - napsReimbMinor,
  };
}
