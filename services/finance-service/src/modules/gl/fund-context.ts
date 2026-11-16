/**
 * Section 8 NF-0 (docs/design/SECTION8-NONPROFIT-FINANCE.md §2, §9, §10): the single `fundContext()` seam.
 *
 * EVERY write of a journal, journal line or ledger line in the finance posting path routes its row through the context
 * resolved here, so NF-1 (fund master + fund tagging) has exactly one place to add `fund_id` and cannot miss a call-site.
 * `tests/nf0-fund-context-guard.test.ts` enforces that statically.
 *
 * NF-0 builds the seam only; it tags NOTHING, whether the flag is off or on:
 *   - fund_accounting OFF (gl.finance_settings.fund_accounting false or NULL, or no settings row -- every govt tenant):
 *     `enabled` is false and every tag*() returns the SAME row object it was given, untouched. No extra write, no changed
 *     column, no changed result: govt behaviour is byte-identical.
 *   - fund_accounting ON: `enabled` is true, but there is no fund master yet, so tag*() is still the identity. The
 *     fail-closed rule (design contract #5: flag on + funds/heads absent => refuse to post) needs the fund master and
 *     belongs to NF-1; it is deliberately NOT faked here. Nothing activates the flag before NF-8.
 *
 * Resolved ONCE per posting, from the tenant's own gl.finance_settings row (the same table budget_control / coa_template
 * come from). No env var, no profile catalogue lookup (a lint test bans those from the posting modules).
 */
import { eq } from "drizzle-orm";
import { financeSettings } from "../approvals/schema.js";

/** What a ledger/journal write needs from the fund dimension. NF-1 extends the tag* methods; NF-0 leaves rows untouched. */
export interface FundContext {
  /** Whether fund accounting is on for this tenant (the stored flag). Informational in NF-0; NF-1 branches on it. */
  readonly enabled: boolean;
  /** gl.finance_journals row (incl. its JSONB `lines`). */
  tagJournal<T extends object>(row: T): T;
  /** gl.finance_journal_lines row. */
  tagJournalLine<T extends object>(row: T): T;
  /** gl.finance_ledger row (the book of record). */
  tagLedgerLine<T extends object>(row: T): T;
}

const identity = <T extends object>(row: T): T => row;

/** Pure: build the context from the stored flag. NULL / undefined / false => disabled. */
export function fundContextFromFlag(fundAccounting: boolean | null | undefined): FundContext {
  return Object.freeze({ enabled: fundAccounting === true, tagJournal: identity, tagJournalLine: identity, tagLedgerLine: identity });
}

/**
 * Resolve the fund context for one posting. Call once, inside the posting transaction, before the first journal/ledger
 * write. No settings row (a tenant that never saved settings) reads as OFF, like every other settings default.
 */
export async function fundContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any, tenantId: string,
): Promise<FundContext> {
  const rows: Array<{ f: boolean | null }> = await tx.select({ f: financeSettings.fundAccounting }).from(financeSettings)
    .where(eq(financeSettings.tenantId, tenantId)).limit(1);
  return fundContextFromFlag(rows[0]?.f);
}
