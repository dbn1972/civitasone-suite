/**
 * Pure debt-instrument rules: EMI schedule generation (reducing balance).
 *
 * All arithmetic is bigint paise. The EMI uses the standard annuity formula
 *   EMI = P * r * (1+r)^n / ((1+r)^n - 1),   r = annual_rate / 12
 * evaluated in fixed-point (scale 1e18) so no float ever touches money. The
 * final instalment absorbs the rounding residue so the principal parts sum to
 * the principal exactly. Interest each month is balance * rate / 12, rounded
 * half-up to the paisa.
 */

export class DebtDomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DebtDomainError";
  }
}

export type EmiRow = {
  installmentNo: number;
  dueDate: string;
  principalMinor: bigint;
  interestMinor: bigint;
  totalMinor: bigint;
};

const SCALE = 10n ** 18n;

function divRound(n: bigint, d: bigint): bigint {
  return (n + d / 2n) / d;
}

/** firstEmiDate + `months` months (YYYY-MM-DD), clamping the day to the target month's length. */
export function addMonths(iso: string, months: number): string {
  const y0 = Number(iso.slice(0, 4));
  const m0 = Number(iso.slice(5, 7)) - 1;
  const day = Number(iso.slice(8, 10));
  const total = m0 + months;
  const y = y0 + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

export function buildEmiSchedule(input: {
  principalMinor: bigint;
  interestRateBps: number;
  tenureMonths: number;
  firstEmiDate: string;
}): EmiRow[] {
  const { principalMinor: P, interestRateBps: bps, tenureMonths: n, firstEmiDate } = input;
  if (P <= 0n) throw new DebtDomainError("DEBT_PRINCIPAL_INVALID", "principal must be greater than zero");
  if (!Number.isInteger(n) || n < 1 || n > 600) throw new DebtDomainError("DEBT_TENURE_INVALID", "tenure must be 1 to 600 months");
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new DebtDomainError("DEBT_RATE_INVALID", "interest rate must be between 0% and 100%");

  const bigN = BigInt(n);
  let emi: bigint;
  if (bps === 0) {
    emi = divRound(P, bigN);
  } else {
    const rS = (BigInt(bps) * SCALE) / 120_000n; // monthly rate, scaled
    let pow = SCALE;
    for (let i = 0; i < n; i += 1) pow = (pow * (SCALE + rS)) / SCALE;
    emi = divRound(P * rS * pow, SCALE * (pow - SCALE));
  }

  const rows: EmiRow[] = [];
  let balance = P;
  for (let i = 1; i <= n; i += 1) {
    const interest = divRound(balance * BigInt(bps), 120_000n);
    let principal = i === n ? balance : emi - interest;
    if (principal > balance) principal = balance;
    if (principal < 0n) principal = 0n;
    rows.push({
      installmentNo: i,
      dueDate: addMonths(firstEmiDate, i - 1),
      principalMinor: principal,
      interestMinor: interest,
      totalMinor: principal + interest,
    });
    balance -= principal;
  }
  return rows;
}

/** Principal still to repay = sum of the principal parts of instalments not yet paid. */
export function outstandingFromSchedule(rows: ReadonlyArray<{ principalMinor: bigint; status: string }>): bigint {
  return rows.filter((r) => r.status !== "paid").reduce((a, r) => a + r.principalMinor, 0n);
}

/** Calendar date (YYYY-MM-DD) in IST for an instant. */
export function istDate(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * Validate the date an instalment was paid: a real date, not in the future (IST), and not before the loan
 * started (taken as one month before the first instalment).
 */
export function assertPaidOnValid(paidOn: string, firstEmiDate: string | null, today: string = istDate()): void {
  if (paidOn > today) throw new DebtDomainError("EMI_PAID_ON_FUTURE", "the payment date cannot be in the future");
  if (firstEmiDate && paidOn < addMonths(firstEmiDate, -1)) {
    throw new DebtDomainError("EMI_PAID_ON_BEFORE_LOAN", "the payment date is before the loan started");
  }
}

/** Instalments must be recorded in order: the lowest-numbered instalment still due is the only one that can be paid. */
export function assertPaidInOrder(installmentNo: number, lowestDueNo: number | null): void {
  if (lowestDueNo !== null && installmentNo > lowestDueNo) {
    throw new DebtDomainError("EMI_OUT_OF_ORDER", `instalment ${lowestDueNo} is still due; record it before instalment ${installmentNo}`);
  }
}

/**
 * The GL refuses a journal in a hard-closed period, and in a soft-closed one for anything but adjustments, so a
 * debt posting dated there would dead-letter after the register already moved. Refuse it up front instead.
 */
export function assertPeriodPostable(status: string, date: string): void {
  if (status === "hard_close" || status === "soft_close") {
    throw new DebtDomainError("PERIOD_CLOSED", `the period of ${date} is ${status === "hard_close" ? "hard" : "soft"}-closed; choose a date in an open period`);
  }
}
