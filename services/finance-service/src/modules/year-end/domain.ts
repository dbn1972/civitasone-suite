/**
 * UAT T-PERIOD year-end (ERP-head decisions 2026-11-05, owner-delegated):
 *  - statements (TB, I&E, receipts & payments, balance sheet) are bounded by the financial year, not cumulative;
 *  - only CARRY-FORWARD heads open the new year with a balance: balance-sheet heads (assets, liabilities, equity /
 *    funds), deposits, advances, suspense and the Public Account (major heads 8000-8999), plus loans;
 *  - revenue (income) and expenditure heads start the new year at ZERO: their net for the year is carried into the
 *    accumulated fund (ACCUMULATED_FUND), which is what keeps the opening trial balance balanced;
 *  - the 31 March lapse statement: per budget head, final grant (RE, after supplementary grants and re-appropriation)
 *    minus expenditure = the unspent provision that lapses (GFR: it is not carried forward).
 * Pure functions only; amounts are signed paise, DEBIT-positive (dr - cr).
 */
import { headNatureOf, type HeadNature } from "../../shared/head-nature.js";

const CARRY_FORWARD_CLASSIFICATIONS = new Set(["deposit", "deposits", "advance", "advances", "suspense", "public_account", "loan", "loans"]);

/** True when the head carries its closing balance into the next financial year. */
export function isCarryForwardHead(code: string | null | undefined, classification: string | null | undefined): boolean {
  const c = (code ?? "").trim();
  const n = /^\d{4}$/.test(c) ? Number(c) : NaN;
  // Public Account of India / the State (CGA major heads 8001-8999): deposits, advances, suspense, remittances, cash balance
  if (n >= 8000 && n <= 8999) return true;
  const cls = (classification ?? "").trim().toLowerCase();
  if (CARRY_FORWARD_CLASSIFICATIONS.has(cls) && headNatureOf(c, classification) !== "income") return true;
  const nature: HeadNature = headNatureOf(c, classification);
  return nature === "asset" || nature === "liability" || nature === "equity";
}

export type HeadMovement = { code: string; name: string | null; classification: string | null; dr: bigint; cr: bigint };

/**
 * Roll balances forward: `base` (signed opening by head code at the start of the window) plus `movements` within the
 * window. Carry-forward heads keep their balance; every other head (income / expenditure) is folded into `fundCode`
 * (its signed net, so a surplus lands as a credit on the fund). Zero balances are dropped. The result always sums to
 * the same total as base + movements (zero for a balanced ledger).
 */
export function rollForward(
  base: ReadonlyMap<string, bigint>,
  movements: ReadonlyArray<HeadMovement>,
  classify: (code: string) => { classification: string | null },
  fundCode: string,
): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const add = (code: string, v: bigint) => out.set(code, (out.get(code) ?? 0n) + v);
  for (const [code, v] of base) {
    if (code === fundCode || isCarryForwardHead(code, classify(code).classification)) add(code, v);
    else add(fundCode, v);
  }
  for (const m of movements) {
    const v = m.dr - m.cr;
    if (m.code === fundCode || isCarryForwardHead(m.code, m.classification)) add(m.code, v);
    else add(fundCode, v);
  }
  for (const [k, v] of [...out]) if (v === 0n) out.delete(k);
  return out;
}

/** Signed balance -> the debit / credit columns of an opening-balance row. */
export function toDrCr(signed: bigint): { debitMinor: bigint; creditMinor: bigint } {
  return signed >= 0n ? { debitMinor: signed, creditMinor: 0n } : { debitMinor: 0n, creditMinor: -signed };
}

export type BudgetForLapse = { budgetId: string; headId: string; headCode: string; headName: string; beMinor: bigint; reMinor: bigint; utilisedMinor: bigint };
export type LapseRow = {
  budgetId: string; headId: string; headCode: string; headName: string;
  beMinor: bigint; reMinor: bigint; reappropriationNetMinor: bigint; expenditureMinor: bigint; lapseMinor: bigint; excessMinor: bigint;
};

/**
 * The 31 March lapse statement line for one budget head: the final grant is RE (re_minor already reflects supplementary
 * grants and zero-sum re-appropriation transfers -- budget/repo.ts transferBudgetReMinorGuarded); unspent = final
 * grant - expenditure lapses; an overrun is reported as excess (for regularisation), never as a negative lapse.
 */
export function lapseRow(b: BudgetForLapse): LapseRow {
  const diff = b.reMinor - b.utilisedMinor;
  return {
    budgetId: b.budgetId, headId: b.headId, headCode: b.headCode, headName: b.headName,
    beMinor: b.beMinor, reMinor: b.reMinor, reappropriationNetMinor: b.reMinor - b.beMinor,
    expenditureMinor: b.utilisedMinor, lapseMinor: diff > 0n ? diff : 0n, excessMinor: diff < 0n ? -diff : 0n,
  };
}

export function lapseTotals(rows: ReadonlyArray<LapseRow>) {
  const t = { beMinor: 0n, reMinor: 0n, expenditureMinor: 0n, lapseMinor: 0n, excessMinor: 0n };
  for (const r of rows) {
    t.beMinor += r.beMinor; t.reMinor += r.reMinor; t.expenditureMinor += r.expenditureMinor;
    t.lapseMinor += r.lapseMinor; t.excessMinor += r.excessMinor;
  }
  return t;
}

/** Every month (YYYY-MM) of a financial year "YYYY-YY", April to March. */
export function monthsOfFy(fy: string): string[] {
  const y = Number(fy.slice(0, 4));
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1;
    out.push(`${m >= 4 ? y : y + 1}-${String(m).padStart(2, "0")}`);
  }
  return out;
}
