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
  if (!lines || lines.length < 2) {
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

/**
 * A MANUALLY-created journal must actually move money: a balanced 0/0 entry
 * has nothing to post. Deliberately NOT folded into assertJournalBalances()
 * above, which gl/consumer.ts's postJournal() also calls for AUTOMATED
 * GL-spine postings (depreciation, asset disposal, payroll settlement, an
 * upstream accrual with a genuine zero net movement — e.g. a payroll run
 * approved with no slips, or an empty stock entry). postJournal() treats
 * that zero-total case as a harmless no-op ack, which is correct there —
 * nobody is waiting on an approval for those. A manual maker-checker draft
 * (finance.gl.create) is different: a maker explicitly created it and a
 * checker explicitly approves it, so hitting that same "harmless no-op"
 * inside postJournal() left the checker's approval returning 202 with no
 * way to discover it had silently done nothing — the journal stayed
 * pending_approval forever (see the zero-amount-journal-approval repro).
 * Call this only from the manual creation path (gl/commands.ts
 * createJournal(), gl/consumer.ts's finance.gl.create handler, and
 * validators.ts's postJournalBody schema) so a human-authored draft with
 * nothing on either side is rejected up front, before a checker is ever
 * asked to approve it.
 */
export function assertJournalHasAmount(lines: JournalLine[]): void {
  const totalDebit = lines.reduce((acc, l) => acc + BigInt(l.debitMinor), 0n);
  if (totalDebit === 0n) {
    throw new DomainError(
      "JOURNAL_ZERO_AMOUNT",
      "journal has a zero net amount: a balanced 0/0 entry has nothing to post"
    );
  }
}
