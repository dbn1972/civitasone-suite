/** Pure rules for the finance maker-checker / change-request workflow. */
import { BUDGET_CONTROLS, COA_TEMPLATES, type BudgetControl, type CoaTemplate } from "@civitasone/tenant-profile";
import { DomainError } from "../masters/domain.js";

export { BUDGET_CONTROLS, COA_TEMPLATES };
export type { BudgetControl, CoaTemplate };

export { DomainError };

// UAT T-PERIOD D-01: period_reopen -- reopening a HARD-closed month (second finance_admin; migration 0161).
export const CHANGE_REQUEST_KINDS = ["fiscal_year_activate", "opening_balances_enter", "hoa_change", "settings_relax", "period_reopen", "ar_opening_balance"] as const;
// AR sub-ledger opening-balance import (migration 0167): ar_opening_balance -- a batch of AR-only rows (never a journal).
export type ChangeRequestKind = (typeof CHANGE_REQUEST_KINDS)[number];

export type FinanceSettings = {
  makerCheckerEnabled: boolean;
  blockFyActivationOpenPeriods: boolean;
  requireOpeningBalancesForActivation: boolean;
  fyCreateAsDraft: boolean;
  /** GL heads the debt register posts to; null until configured (there are NO defaults). */
  debtLoanLiabilityHeadId: string | null;
  debtInterestExpenseHeadId: string | null;
  debtBankHeadId: string | null;
  /**
   * UAT L2-N6 review: how stock movements reach the GL. "cash" (DEFAULT -- Indian government accounts): expenditure
   * is booked against the budget head when the bill is passed and stores are a memorandum only, so an inventory
   * movement posts NO journal. "accrual": stock is an asset (Dr Stores / Cr GRNI or stores suspense; issue Dr the
   * consuming head / Cr Stores) and the GRN bill clears GRNI (gl/inventory-movement.ts, gl/grni-clearing.ts).
   */
  accountingBasis: AccountingBasis;
  /**
   * Tenant-type profile switch. mandatory (DEFAULT, GFR): an expenditure debit with no budget provision is refused.
   * advisory: posted with a warning and an audit row. off: no budget check and no utilisation tracking.
   */
  budgetControl: BudgetControl;
  /** Chart-of-accounts template the tenant was provisioned with. govt = today's chart. */
  coaTemplate: CoaTemplate;
  /** The tenant profile the settings were seeded from. Informational. */
  profileCode: string;
  /** An approved switch of the accounting basis, applied automatically at the FY rollover on `pendingBasisEffectiveFrom` (a 1 April). */
  pendingAccountingBasis: AccountingBasis | null;
  pendingBasisEffectiveFrom: string | null;
};

export type AccountingBasis = "cash" | "accrual";
export const ACCOUNTING_BASES = ["cash", "accrual"] as const;

/** Conservative defaults used when a tenant has no gl.finance_settings row. */
export const SETTINGS_DEFAULTS: FinanceSettings = {
  makerCheckerEnabled: true,
  blockFyActivationOpenPeriods: true,
  requireOpeningBalancesForActivation: false,
  fyCreateAsDraft: true,
  debtLoanLiabilityHeadId: null,
  debtInterestExpenseHeadId: null,
  debtBankHeadId: null,
  accountingBasis: "cash",
  budgetControl: "mandatory",
  coaTemplate: "govt",
  profileCode: "govt_dept",
  pendingAccountingBasis: null,
  pendingBasisEffectiveFrom: null,
};

const BUDGET_CONTROL_RANK: Record<BudgetControl, number> = { off: 0, advisory: 1, mandatory: 2 };

/** Coerce a stored value to a known budget control; anything unknown reads as the strictest (mandatory). */
export function toBudgetControl(v: unknown): BudgetControl {
  return (BUDGET_CONTROLS as readonly string[]).includes(v as string) ? (v as BudgetControl) : "mandatory";
}

export function toCoaTemplate(v: unknown): CoaTemplate {
  return (COA_TEMPLATES as readonly string[]).includes(v as string) ? (v as CoaTemplate) : "govt";
}

/** The next 1 April strictly after `todayIst` (YYYY-MM-DD): the only date an accounting-basis switch can take effect. */
export function nextAprilFirst(todayIst: string): string {
  const y = Number(todayIst.slice(0, 4));
  return todayIst < `${y}-04-01` ? `${y}-04-01` : `${y + 1}-04-01`;
}

/**
 * Owner decision 3 (2026-11-06, amended): an accounting-basis switch is approved at any time and takes effect on the
 * NEXT 1 April, applied automatically at the FY rollover (see applyPendingBasisSwitchTx). Run when the request is made.
 * No date given = the next 1 April. A date that is not a 1 April is mid-year; a 1 April that is not the next one is refused.
 * Only enforced while TENANT_PROFILES_ENABLED is on. Returns the effective date.
 */
export function resolveBasisEffectiveFrom(effectiveFrom: string | undefined, todayIst: string): string {
  const next = nextAprilFirst(todayIst);
  if (!effectiveFrom) return next;
  if (!/^\d{4}-04-01$/.test(effectiveFrom)) {
    throw new DomainError("BASIS_SWITCH_MID_YEAR", `an accounting basis can change only from the start of a financial year (1 April); ${effectiveFrom} is mid-year`);
  }
  if (effectiveFrom !== next) {
    throw new DomainError("BASIS_SWITCH_DATE", `the switch can take effect only on the next 1 April (${next}); ${effectiveFrom} is not it`);
  }
  return effectiveFrom;
}

/** Run when the request is approved: an approval that arrives on or after its effective date is stale and must be raised again. */
export function assertBasisSwitchApprovable(effectiveFrom: string, todayIst: string): void {
  if (!/^\d{4}-04-01$/.test(effectiveFrom)) {
    throw new DomainError("BASIS_SWITCH_MID_YEAR", `an accounting basis can change only from the start of a financial year (1 April); ${effectiveFrom || "no date"} is mid-year`);
  }
  if (todayIst >= effectiveFrom) {
    throw new DomainError("BASIS_SWITCH_STALE", `the request was for ${effectiveFrom}, which has been reached; raise the request again for the next 1 April`);
  }
}

/** The controls whose switching OFF needs a second admin (turning one ON stays direct). */
export const RELAXABLE_SETTINGS = ["makerCheckerEnabled", "blockFyActivationOpenPeriods", "requireOpeningBalancesForActivation"] as const;

/** True when `changes` turns any control in RELAXABLE_SETTINGS from true to false. */
export function isRelaxingControl(current: FinanceSettings, changes: Partial<FinanceSettings>): boolean {
  // Tenant-type profile switch: a LOOSER budget control (mandatory > advisory > off) needs a second admin; a tighter one stays direct.
  if (changes.budgetControl !== undefined && BUDGET_CONTROL_RANK[changes.budgetControl] < BUDGET_CONTROL_RANK[current.budgetControl]) return true;
  // UAT L2-N6 review: switching the accounting basis changes what every later stock movement books -- a second admin.
  if (changes.accountingBasis !== undefined && changes.accountingBasis !== current.accountingBasis) return true;
  return RELAXABLE_SETTINGS.some((k) => current[k] === true && changes[k] === false);
}

/** Request kinds that always need a distinct approver, whatever the maker-checker setting says. */
export function alwaysDistinctApprover(kind: string): boolean {
  // UAT T-PERIOD review: a hard-close reopen always needs a second officer, whatever the setting says at decision time.
  // An AR opening import writes sub-ledger rows with no journal behind them, so it ALWAYS needs a second officer.
  return kind === "settings_relax" || kind === "period_reopen" || kind === "ar_opening_balance";
}

export type DebtGlHeads = { loanLiability: string; interestExpense: string; bank: string };

/** All three debt GL heads configured, or null. */
export function configuredDebtHeads(s: Pick<FinanceSettings, "debtLoanLiabilityHeadId" | "debtInterestExpenseHeadId" | "debtBankHeadId">): DebtGlHeads | null {
  if (!s.debtLoanLiabilityHeadId || !s.debtInterestExpenseHeadId || !s.debtBankHeadId) return null;
  return { loanLiability: s.debtLoanLiabilityHeadId, interestExpense: s.debtInterestExpenseHeadId, bank: s.debtBankHeadId };
}

/**
 * The debt GL heads must exist (existence is the activity test: every head is active), be of the right
 * type (loan liability = liability, interest expense = expense, bank = asset) and be three DIFFERENT heads.
 * `found` maps head id -> its effective type, or is missing the id when the head does not exist.
 */
export function assertDebtHeadsValid(heads: DebtGlHeads, found: ReadonlyMap<string, { type: string; leaf: boolean }>): void {
  const want: Array<[keyof DebtGlHeads, string]> = [["loanLiability", "liability"], ["interestExpense", "expense"], ["bank", "asset"]];
  for (const [role, type] of want) {
    const h = found.get(heads[role]);
    if (h === undefined) throw new DomainError("GL_HEAD_NOT_FOUND", `the ${role} head does not exist in this office's chart of accounts`);
    if (h.type !== type) throw new DomainError("GL_HEAD_WRONG_TYPE", `the ${role} head must be a${type === "asset" ? "n" : ""} ${type} head (it is ${h.type})`);
    // The GL refuses postings to a head that has child heads (NOT_LEAF_ACCOUNT): catch it here, not as a journal that never posts.
    if (!h.leaf) throw new DomainError("GL_HEAD_NOT_LEAF", `the ${role} head has child heads; choose a leaf head (postings to a group head are refused)`);
  }
  if (new Set([heads.loanLiability, heads.interestExpense, heads.bank]).size !== 3) {
    throw new DomainError("GL_HEADS_CLASH", "the loan liability, interest expense and bank heads must be three different heads");
  }
}

/**
 * Maker != checker. Throws a 409-class DomainError when the deciding officer is
 * the one who raised the request. A no-op when the tenant has switched the
 * second-approver policy off.
 */
export function assertDistinctApprover(requestedBy: string, actorId: string, enforce: boolean): void {
  if (enforce && requestedBy === actorId) {
    throw new DomainError("MAKER_CHECKER_VIOLATION", "the officer who raised a change cannot approve or reject it; a different officer must decide");
  }
}

/** Every calendar month (YYYY-MM) an inclusive ISO date range touches. */
export function monthsInRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let y = Number(startDate.slice(0, 4));
  let m = Number(startDate.slice(5, 7));
  const endY = Number(endDate.slice(0, 4));
  const endM = Number(endDate.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/**
 * Months of `year` that are not hard-closed. A month with no period-close row
 * is open (rows only exist once someone closes a period).
 */
export function openPeriodsOfYear(
  year: { startDate: string; endDate: string },
  periodRows: ReadonlyArray<{ period: string; status: string }>,
): string[] {
  const hard = new Set(periodRows.filter((r) => r.status === "hard_close").map((r) => r.period));
  return monthsInRange(year.startDate, year.endDate).filter((p) => !hard.has(p));
}

export function assertFiscalYearActivationAllowed(input: {
  settings: FinanceSettings;
  targetCode: string;
  outgoing: ReadonlyArray<{ code: string; startDate: string; endDate: string }>;
  periodRows: ReadonlyArray<{ period: string; status: string }>;
  targetOpeningBalanceCount: number;
}): void {
  const { settings, targetCode, outgoing, periodRows, targetOpeningBalanceCount } = input;
  if (settings.blockFyActivationOpenPeriods) {
    for (const y of outgoing) {
      const open = openPeriodsOfYear(y, periodRows);
      if (open.length > 0) {
        throw new DomainError(
          "FY_OPEN_PERIODS",
          `fiscal year ${y.code} still has ${open.length} period(s) that are not hard-closed (${open.slice(0, 3).join(", ")}${open.length > 3 ? ", ..." : ""}); hard-close them before activating ${targetCode}`,
        );
      }
    }
  }
  if (settings.requireOpeningBalancesForActivation && outgoing.length > 0 && targetOpeningBalanceCount === 0) {
    throw new DomainError("FY_OPENING_BALANCES_MISSING", `fiscal year ${targetCode} has no opening balances; enter them before activating it`);
  }
}
