/**
 * Section 8 (docs/design/SECTION8-NONPROFIT-FINANCE.md §2, §9, §10): the single `fundContext()` seam.
 *
 * EVERY write of a journal, journal line, ledger line (and opening-balance row) in the finance posting path routes its row
 * through the context resolved here, so there is exactly one place that decides a row's `fund_id` and no call-site can miss
 * it. `tests/nf0-fund-context-guard.test.ts` enforces that statically (NF-0, hardened in NF-1).
 *
 * fund_accounting OFF (gl.finance_settings.fund_accounting false or NULL, or no settings row -- every govt tenant):
 *   `enabled` is false and every tag*() returns the SAME row object it was given, untouched (strict identity): no extra
 *   write, no changed column, no changed result. govt behaviour is byte-identical. A line that names a fund while the flag is
 *   OFF is REFUSED (FUND_ACCOUNTING_DISABLED) rather than silently dropped, so the JSONB can never disagree with the ledger.
 *
 * fund_accounting ON (NF-1):
 *   every journal line, journal-line row and ledger line carries a `fund_id`: the fund the line names, else the tenant's
 *   GENERAL (unrestricted) fund. The fund of a line is resolved by `fundOfLine()` -- the ONE function the JSONB element, the
 *   journal-line row and the ledger line all call -- so the three can never drift. ON with no GENERAL fund => the context
 *   cannot be built (FUND_ACCOUNTING_NOT_READY, design contract #5, fail-closed): posting is refused, never defaulted to an
 *   untagged row.
 *
 * Resolved ONCE per posting, from the tenant's own gl.finance_settings row, via loadPostingSettingsTx (the same single read
 * that also yields budget_control). No env var, no profile catalogue lookup (a lint test bans those from the posting modules).
 * S5: the context is resolved at the POSTING (approval) moment, which is authoritative -- a manual draft is only a request.
 */
import {
  loadPostingSettingsTx, assertFundPostingReady, type PostingSettings,
} from "../approvals/posting-settings.js";
import { DomainError } from "../approvals/domain.js";

type FundedLine = { fundId?: string | null | undefined };

/** What a ledger/journal write needs from the fund dimension. */
export interface FundContext {
  /** Whether fund accounting is on for this tenant (the stored flag). */
  readonly enabled: boolean;
  /** The tenant's GENERAL fund id when enabled, else null. */
  readonly generalFundId: string | null;
  /**
   * The fund a line posts to: null when disabled; otherwise its own `fundId` or GENERAL. Throws FUND_ACCOUNTING_DISABLED when
   * the flag is off but the line names a fund.
   */
  fundOfLine(line: FundedLine): string | null;
  /** gl.finance_journals row (incl. its JSONB `lines`): every element gains `fundId` (same source as the ledger line). */
  tagJournal<T extends object>(row: T): T;
  /** gl.finance_journal_lines row. `fundId` is the line's own fund (from the journal line) or omitted for GENERAL. */
  tagJournalLine<T extends object>(row: T, fundId?: string | null): T;
  /** gl.finance_ledger row (the book of record). */
  tagLedgerLine<T extends object>(row: T, fundId?: string | null): T;
  /** gl.finance_opening_balances row. */
  tagOpeningBalance<T extends object>(row: T, fundId?: string | null): T;
}

const identity = <T extends object>(row: T): T => row;

function disabledContext(): FundContext {
  return Object.freeze({
    enabled: false, generalFundId: null,
    fundOfLine: (line: FundedLine): string | null => {
      if (line.fundId) throw new DomainError("FUND_ACCOUNTING_DISABLED", "a journal line names a fund but fund accounting is off for this tenant");
      return null;
    },
    tagJournal: identity, tagJournalLine: identity, tagLedgerLine: identity, tagOpeningBalance: identity,
  });
}

function enabledContext(general: string): FundContext {
  const fundOfLine = (line: FundedLine): string => line.fundId || general;
  const withFund = <T extends object>(row: T, fundId?: string | null): T => ({ ...row, fundId: fundId || general });
  return Object.freeze({
    enabled: true, generalFundId: general, fundOfLine,
    tagJournal: <T extends object>(row: T): T => {
      const lines = (row as { lines?: unknown }).lines;
      if (!Array.isArray(lines)) return row;
      return { ...row, lines: lines.map((l: FundedLine) => ({ ...l, fundId: fundOfLine(l) })) };
    },
    tagJournalLine: withFund, tagLedgerLine: withFund, tagOpeningBalance: withFund,
  });
}

/** Pure: build the context from the already-loaded posting settings. Throws FUND_ACCOUNTING_NOT_READY (fail-closed). */
export function fundContextFromSettings(ps: Pick<PostingSettings, "fundAccounting" | "generalFundId">): FundContext {
  if (!ps.fundAccounting) return disabledContext();
  assertFundPostingReady(ps);
  return enabledContext(ps.generalFundId as string);
}

/** Pure: build the context from the stored flag (and the GENERAL fund id when ON). NULL / undefined / false => disabled. */
export function fundContextFromFlag(fundAccounting: boolean | null | undefined, generalFundId: string | null = null): FundContext {
  return fundContextFromSettings({ fundAccounting: fundAccounting === true, generalFundId });
}

/**
 * Resolve the fund context for one posting. Call once, inside the posting transaction, before the first journal/ledger
 * write. Pass `ps` when the caller already read the settings (the posting path reads them once for budget_control too).
 * No settings row (a tenant that never saved settings) reads as OFF, like every other settings default.
 */
export async function fundContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any, tenantId: string, ps?: PostingSettings,
): Promise<FundContext> {
  return fundContextFromSettings(ps ?? await loadPostingSettingsTx(tx, tenantId));
}

/**
 * S5: a writer that cannot tag funds (the MSME `simplified` chart posts journals whose heads are placeholder ids and
 * writes no fund-aware ledger rows) must REFUSE while fund accounting is on, never write untagged rows into a fund-accounted
 * tenant. Strict no-op (one settings read) when the flag is off.
 */
export async function assertFundAccountingOffTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any, tenantId: string, writer: string,
): Promise<void> {
  const ps = await loadPostingSettingsTx(tx, tenantId);
  if (ps.fundAccounting) {
    throw new DomainError("FUND_UNSUPPORTED_WRITER", `${writer} cannot post while fund accounting is on: it cannot tag a fund, and an untagged journal would corrupt the per-fund books`);
  }
}
