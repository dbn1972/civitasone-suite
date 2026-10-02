/** Pure domain logic for finance masters (fiscal years, opening balances). */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

// string = base-10 paise (bigint-safe queue transport, GAP-FINANCE-OPENING-BALANCES-01).
type BalanceEntry = { debitMinor: number | bigint | string; creditMinor: number | bigint | string };

/**
 * Opening-balance entries must balance: sum(debit) == sum(credit), exactly
 * like a GL journal (see gl/domain.ts's assertJournalBalances). Without this,
 * a direct API call bypassing the client's own "fail closed" balance check
 * can post a FY's opening trial balance that never balances -- every
 * downstream report built on it (trial balance, financial statements)
 * inherits the corruption. Checked in bigint, not float: paise can exceed
 * 2^53 in aggregate across many entries.
 */
export function assertOpeningBalancesBalanced(entries: BalanceEntry[]): void {
  // Mirrors gl/domain.ts's assertJournalBalances: a single entry can never
  // form a meaningful opening trial balance (one with equal debit/credit on
  // the SAME entry is a self-cancelling no-op, not a real opening position)
  // -- a real one always touches at least two different accounts.
  if (!entries || entries.length < 2) {
    throw new DomainError(
      "OPENING_BALANCE_TOO_FEW_ENTRIES",
      "an opening balance requires at least 2 entries",
    );
  }
  const totalDebit = entries.reduce((acc, e) => acc + BigInt(e.debitMinor), 0n);
  const totalCredit = entries.reduce((acc, e) => acc + BigInt(e.creditMinor), 0n);
  if (totalDebit !== totalCredit) {
    throw new DomainError(
      "OPENING_BALANCE_UNBALANCED",
      `opening balance entries are unbalanced: debit ${totalDebit} !== credit ${totalCredit}`,
    );
  }
}

export type FiscalYearRange = { code: string; startDate: string; endDate: string };

/**
 * GAP-FINANCE-FISCAL-YEARS-01: creating a fiscal year switches the tenant's
 * posting year, so a duplicate code or a date range that overlaps an existing
 * year must be rejected before it is accepted -- two years claiming the same
 * day make "which year does this posting land in" ambiguous. Dates are ISO
 * YYYY-MM-DD strings, so lexical comparison is chronological. Ranges are
 * inclusive on both ends (a year ends on 31-Mar, the next starts 01-Apr).
 */
export function assertFiscalYearRangeValid(
  next: FiscalYearRange,
  existing: readonly FiscalYearRange[],
): void {
  if (next.endDate <= next.startDate) {
    throw new DomainError("FY_INVALID_RANGE", "fiscal year end date must be after its start date");
  }
  for (const fy of existing) {
    if (fy.code === next.code) {
      throw new DomainError("ALREADY_EXISTS", `fiscal year ${next.code} already exists`);
    }
    if (next.startDate <= fy.endDate && fy.startDate <= next.endDate) {
      throw new DomainError(
        "FY_OVERLAP",
        `fiscal year ${next.code} (${next.startDate} to ${next.endDate}) overlaps existing fiscal year ${fy.code} (${fy.startDate} to ${fy.endDate})`,
      );
    }
  }
}

/** RBI IFSC + account number identify a bank account; compare normalised. */
export function sameBankAccount(
  a: { accountNo: string; ifsc: string },
  b: { accountNo: string; ifsc: string },
): boolean {
  return a.accountNo.trim() === b.accountNo.trim() && a.ifsc.trim().toUpperCase() === b.ifsc.trim().toUpperCase();
}
