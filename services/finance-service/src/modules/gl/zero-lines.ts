import { DomainError } from "./domain.js";
import type { JournalLine } from "./schema.js";

/** A line that moves nothing: debit and credit are both 0. */
export const isZeroLine = (l: JournalLine): boolean => BigInt(l.debitMinor) === 0n && BigInt(l.creditMinor) === 0n;

/**
 * B22 D6: a MANUAL journal line must carry an amount on one side. A 0/0 line adds nothing to the voucher, but it is
 * stored and shown (8 zero lines on head 1250 in UAT: posted CONTRA vouchers and reversed asset disposals).
 * Automated producers (asset disposal with no accumulated depreciation) are not refused: postJournal() drops
 * their 0/0 lines instead, so the disposal still posts.
 */
export function assertNoZeroLines(lines: JournalLine[]): void {
  const i = lines.findIndex(isZeroLine);
  if (i >= 0) {
    throw new DomainError("JOURNAL_ZERO_LINE", `line ${i + 1} has a zero amount: enter a debit or a credit, or remove the line`);
  }
}
