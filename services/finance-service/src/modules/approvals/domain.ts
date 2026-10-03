/** Pure rules for the finance maker-checker / change-request workflow. */
import { DomainError } from "../masters/domain.js";

export { DomainError };

export const CHANGE_REQUEST_KINDS = ["fiscal_year_activate", "opening_balances_enter", "hoa_change", "settings_relax"] as const;
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
};

/** Conservative defaults used when a tenant has no gl.finance_settings row. */
export const SETTINGS_DEFAULTS: FinanceSettings = {
  makerCheckerEnabled: true,
  blockFyActivationOpenPeriods: true,
  requireOpeningBalancesForActivation: false,
  fyCreateAsDraft: true,
  debtLoanLiabilityHeadId: null,
  debtInterestExpenseHeadId: null,
  debtBankHeadId: null,
};

/** The controls whose switching OFF needs a second admin (turning one ON stays direct). */
export const RELAXABLE_SETTINGS = ["makerCheckerEnabled", "blockFyActivationOpenPeriods", "requireOpeningBalancesForActivation"] as const;

/** True when `changes` turns any control in RELAXABLE_SETTINGS from true to false. */
export function isRelaxingControl(current: FinanceSettings, changes: Partial<FinanceSettings>): boolean {
  return RELAXABLE_SETTINGS.some((k) => current[k] === true && changes[k] === false);
}

/** Request kinds that always need a distinct approver, whatever the maker-checker setting says. */
export function alwaysDistinctApprover(kind: string): boolean {
  return kind === "settings_relax";
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
