/** Pure GL domain logic. */
import type { JournalLine } from "./schema.js";

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

/**
 * Journal lines must balance: sum(debit) == sum(credit).
 * H3: paise can exceed 2^53, so balance is checked in bigint, not float.
 */
export function assertJournalBalances(lines: JournalLine[]): void {
  if (lines.length < 2) {
    throw new DomainError("JOURNAL_TOO_FEW_LINES", "a journal requires at least 2 lines");
  }
  const totalDebit  = lines.reduce((acc, l) => acc + BigInt(l.debitMinor),  0n);
  const totalCredit = lines.reduce((acc, l) => acc + BigInt(l.creditMinor), 0n);
  if (totalDebit !== totalCredit) {
    throw new DomainError(
      "JOURNAL_UNBALANCED",
      `journal is unbalanced: debit ${totalDebit} !== credit ${totalCredit}`
    );
  }
}
