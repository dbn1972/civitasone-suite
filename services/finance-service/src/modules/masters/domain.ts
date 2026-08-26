/** Pure domain logic for finance masters (fiscal years, opening balances). */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

type BalanceEntry = { debitMinor: number | bigint; creditMinor: number | bigint };

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
  const totalDebit = entries.reduce((acc, e) => acc + BigInt(e.debitMinor), 0n);
  const totalCredit = entries.reduce((acc, e) => acc + BigInt(e.creditMinor), 0n);
  if (totalDebit !== totalCredit) {
    throw new DomainError(
      "OPENING_BALANCE_UNBALANCED",
      `opening balance entries are unbalanced: debit ${totalDebit} !== credit ${totalCredit}`,
    );
  }
}
