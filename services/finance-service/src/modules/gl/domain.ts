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

export type PeriodRefusalCode = "PERIOD_UNKNOWN" | "PERIOD_CLOSED" | "PERIOD_SOFT_CLOSED";

/**
 * The single rule for "may a journal of this type post into this period?", shared by the posting consumer
 * (gl/consumer.ts postJournal, the authority at posting time) and the synchronous pre-checks in gl/routes.ts
 * (GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-06), so a refusal the HTTP caller sees is exactly the one the consumer would
 * raise. `status` is a period-close status: "open" | "soft_close" | "hard_close" | "unknown" (a period string that is
 * not even shaped like YYYY-MM). Fails CLOSED on unknown; a soft-closed period accepts only adjustment/closing
 * journals. Returns null when the journal may post.
 */
export function periodPostingRefusal(
  status: string,
  journalType: string,
  period: string,
): { code: PeriodRefusalCode; message: string } | null {
  if (status === "unknown") return { code: "PERIOD_UNKNOWN", message: `cannot post to unrecognized period '${period}'` };
  if (status === "hard_close") return { code: "PERIOD_CLOSED", message: `cannot post to hard-closed period ${period}` };
  if (status === "soft_close" && !["adjustment", "closing"].includes(journalType)) {
    return { code: "PERIOD_SOFT_CLOSED", message: `only adjustment/closing journals allowed in soft-closed period ${period}` };
  }
  return null;
}

/**
 * A blank voucher number or the literal "AUTO" (any case) asks the GL to allocate the gapless number at approval time;
 * anything else is a number the officer typed, which must be unique per tenant (UNIQUE(tenant_id, voucher_no)).
 */
export function voucherNeedsAllocation(raw: string | null | undefined): boolean {
  return !raw || raw.trim() === "" || raw.toUpperCase() === "AUTO";
}

/**
 * GAP-FINANCE-JOURNAL-ENTRY-04: a manual journal may not post to a control
 * account (a head maintained by a sub-ledger) -- doing so bypasses the
 * sub-ledger and desynchronises it from the GL.
 */
export function assertNoControlAccounts(controlRefs: readonly string[]): void {
  if (controlRefs.length > 0) {
    throw new DomainError(
      "CONTROL_ACCOUNT",
      `manual journals cannot post to control account(s): ${controlRefs.join(", ")}`,
    );
  }
}
