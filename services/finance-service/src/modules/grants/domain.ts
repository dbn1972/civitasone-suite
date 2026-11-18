/**
 * Section 8 NF-3: the grants-in-aid accounting rules. PURE (no database, no clock): policy -> head mapping, per-category routing,
 * running-total headroom, and the four journal shapes. Every journal line carries the grant's fund id, so each journal balances
 * within its fund (funds.ts assertFundsBalanced) by construction.
 *
 * Deferred-income policy (default):                         Capital-fund policy:
 *   receipt        Dr Bank   / Cr 2320 | 2330 | 2340          receipt (capital)  Dr Bank / Cr 3300
 *   recognition    Dr 2320 | 2330 / Cr 4430 | 4440            capitalisation, release: not applicable (2340/2350/4450 stay idle)
 *   capitalisation Dr 2340    / Cr 2350
 *   release        Dr 2350    / Cr 4450 (in step with depreciation)
 * Head codes come from GRANT_HEAD_CODES() (system-heads.ts), the same single source the nonprofit chart seeds from.
 */
import { DomainError } from "../approvals/domain.js";
import { GRANT_HEAD_CODES, type GrantHeadCodes } from "../gl/system-heads.js";
import "../gl/standard-heads.js"; // side effect: registers the seeded-chart codes the runtime collision guard checks (M3)
import { assertFundsBalanced } from "../gl/funds.js";
import type { JournalLine } from "../gl/schema.js";
import type { CapitalGrantPolicy } from "../approvals/posting-settings.js";
import type { GrantCategory, GrantPostingKind } from "./schema.js";

export type { CapitalGrantPolicy, GrantCategory, GrantPostingKind };

/** The bank / cash head a receipt debits when the caller names none (the same env/default the GL consumer uses for cash). */
export const defaultBankHeadCode = (): string => process.env.FINANCE_CASH_CODE ?? "1100";

/** The capital-grant policy values the setting accepts. */
export const CAPITAL_GRANT_POLICIES: readonly CapitalGrantPolicy[] = ["deferred_income", "capital_fund"];

export type GrantTotals = { receipt: bigint; recognition: bigint; capitalisation: bigint; release: bigint };
export const ZERO_TOTALS: GrantTotals = { receipt: 0n, recognition: 0n, capitalisation: 0n, release: 0n };

export type GrantJournalInput = {
  category: GrantCategory;
  policy: CapitalGrantPolicy;
  fundId: string;
  amountMinor: bigint;
  narration?: string | undefined;
  bankHeadCode?: string | undefined;
  heads?: GrantHeadCodes | undefined;
};

const positive = (amountMinor: bigint): void => {
  if (typeof amountMinor !== "bigint" || amountMinor <= 0n) throw new DomainError("GRANT_AMOUNT", "the amount must be greater than zero");
};

/** The head a grant RECEIPT credits: the category's unutilised-grant liability, or (capital + capital_fund) the Capital Grant Fund. */
export function receiptCreditHead(category: GrantCategory, policy: CapitalGrantPolicy, heads: GrantHeadCodes = GRANT_HEAD_CODES()): string {
  if (category === "salary") return heads.revenueReceiptSalary;
  if (category === "general") return heads.revenueReceiptGeneral;
  return policy === "capital_fund" ? heads.capitalFund : heads.capitalReceipt;
}

/** The (debit, credit) heads of revenue-grant recognition; capital grants are recognised by release instead. */
export function recognitionHeads(category: GrantCategory, heads: GrantHeadCodes = GRANT_HEAD_CODES()): { debit: string; credit: string } {
  if (category === "salary") return { debit: heads.revenueReceiptSalary, credit: heads.revenueIncomeSalary };
  if (category === "general") return { debit: heads.revenueReceiptGeneral, credit: heads.revenueIncomeGeneral };
  throw new DomainError("GRANT_CATEGORY", "a capital grant is recognised as income by release in step with depreciation, not by utilisation");
}

/** Capitalisation / release exist only for a capital grant under the deferred_income policy. */
function assertDeferredCapital(op: "capitalisation" | "release", category: GrantCategory, policy: CapitalGrantPolicy): void {
  if (category !== "capital") throw new DomainError("GRANT_CATEGORY", `${op} applies to capital grants only`);
  if (policy !== "deferred_income") {
    throw new DomainError("GRANT_POLICY_NOT_APPLICABLE", `${op} does not run under the ${policy} capital-grant policy: the grant was credited straight to the Capital Grant Fund`);
  }
}

const line = (accountCode: string, side: "dr" | "cr", amount: bigint, fundId: string, narration: string | undefined): JournalLine => ({
  accountCode, debitMinor: side === "dr" ? amount : 0n, creditMinor: side === "cr" ? amount : 0n, fundId, ...(narration ? { narration } : {}),
});

function finish(lines: JournalLine[]): JournalLine[] {
  assertFundsBalanced(lines.map((l) => ({ debitMinor: l.debitMinor, creditMinor: l.creditMinor, fund: l.fundId ?? null })));
  return lines;
}

export function buildGrantReceipt(i: GrantJournalInput): JournalLine[] {
  positive(i.amountMinor);
  const bank = i.bankHeadCode?.trim() || defaultBankHeadCode();
  return finish([
    line(bank, "dr", i.amountMinor, i.fundId, i.narration),
    line(receiptCreditHead(i.category, i.policy, i.heads), "cr", i.amountMinor, i.fundId, i.narration),
  ]);
}

export function buildRevenueRecognition(i: GrantJournalInput): JournalLine[] {
  positive(i.amountMinor);
  const h = recognitionHeads(i.category, i.heads);
  return finish([line(h.debit, "dr", i.amountMinor, i.fundId, i.narration), line(h.credit, "cr", i.amountMinor, i.fundId, i.narration)]);
}

export function buildCapitalisation(i: GrantJournalInput): JournalLine[] {
  positive(i.amountMinor);
  assertDeferredCapital("capitalisation", i.category, i.policy);
  const h = i.heads ?? GRANT_HEAD_CODES();
  return finish([line(h.capitalReceipt, "dr", i.amountMinor, i.fundId, i.narration), line(h.capitalDeferred, "cr", i.amountMinor, i.fundId, i.narration)]);
}

export function buildCapitalRelease(i: GrantJournalInput): JournalLine[] {
  positive(i.amountMinor);
  assertDeferredCapital("release", i.category, i.policy);
  const h = i.heads ?? GRANT_HEAD_CODES();
  return finish([line(h.capitalDeferred, "dr", i.amountMinor, i.fundId, i.narration), line(h.capitalRelease, "cr", i.amountMinor, i.fundId, i.narration)]);
}

export function buildGrantJournal(kind: GrantPostingKind, i: GrantJournalInput): JournalLine[] {
  switch (kind) {
    case "receipt": return buildGrantReceipt(i);
    case "recognition": return buildRevenueRecognition(i);
    case "capitalisation": return buildCapitalisation(i);
    case "release": return buildCapitalRelease(i);
  }
}

/** Every head code a journal of this kind touches (for the chart-presence check before posting). */
export const journalHeadCodes = (lines: ReadonlyArray<JournalLine>): string[] => [...new Set(lines.map((l) => l.accountCode))];

/** Running-total rule for one more posting of `amountMinor`. Throws a DomainError when it would overdraw the grant. */
export function assertHeadroom(
  kind: GrantPostingKind, category: GrantCategory, policy: CapitalGrantPolicy,
  totals: GrantTotals, sanctionedMinor: bigint, amountMinor: bigint,
): void {
  positive(amountMinor);
  switch (kind) {
    case "receipt":
      if (totals.receipt + amountMinor > sanctionedMinor) {
        throw new DomainError("GRANT_OVER_SANCTION", `receipts would reach ${totals.receipt + amountMinor} paise, above the sanctioned ${sanctionedMinor} paise`);
      }
      return;
    case "recognition":
      recognitionHeads(category); // category check
      if (totals.recognition + amountMinor > totals.receipt) {
        throw new DomainError("GRANT_UTILISATION_EXCEEDS_RECEIPTS", `utilisation would reach ${totals.recognition + amountMinor} paise, above the ${totals.receipt} paise received`);
      }
      return;
    case "capitalisation":
      assertDeferredCapital("capitalisation", category, policy);
      if (totals.capitalisation + amountMinor > totals.receipt) {
        throw new DomainError("GRANT_CAPITALISATION_EXCEEDS_RECEIPTS", `capitalisation would reach ${totals.capitalisation + amountMinor} paise, above the ${totals.receipt} paise received`);
      }
      return;
    case "release":
      assertDeferredCapital("release", category, policy);
      if (totals.release + amountMinor > totals.capitalisation) {
        throw new DomainError("GRANT_RELEASE_EXCEEDS_CAPITALISED", `release would reach ${totals.release + amountMinor} paise, above the ${totals.capitalisation} paise capitalised`);
      }
      return;
  }
}

/** Unspent revenue-grant balance after the postings in `t` (received less recognised). Meaningful for salary / general grants. */
export const unspentMinor = (t: GrantTotals): bigint => t.receipt - t.recognition;

/**
 * True when running totals still satisfy the headroom invariants assertHeadroom enforces one posting at a time: nothing recognised
 * or capitalised beyond what was received, nothing released beyond what was capitalised. Used by the finance.gl.rejected reconciler
 * to flag (needs_review) a grant whose remaining live postings leaned on a voided one.
 */
export const totalsAreConsistent = (t: GrantTotals): boolean =>
  t.recognition <= t.receipt && t.capitalisation <= t.receipt && t.release <= t.capitalisation;
