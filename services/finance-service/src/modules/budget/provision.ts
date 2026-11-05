/**
 * UAT T-PERIOD D-03 (ERP-head decision 2026-11-05): GFR -- no expenditure may be incurred without a budget provision
 * for the head in the financial year. A debit to an EXPENDITURE head (shared/head-nature.ts) with no
 * budget.finance_budgets row for (head, FY) is REFUSED with NO_BUDGET_PROVISION -- it used to post as "not budget
 * controlled". Applies to bill passing, payments, manual journals, payroll accruals and sanctions. Receipts are not
 * affected (they never debit an expenditure head), and neither are the non-cash / memorandum journals listed below.
 *
 * Pure rules here; the posting consumer (gl/consumer.ts postJournal) is the authority, and the HTTP routes call
 * assertProvisionSync so the officer gets a synchronous 422 instead of a 202 that is refused later.
 */
import { and, eq, inArray } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { headNatureOf } from "../../shared/head-nature.js";
import { fyOfDate } from "../../shared/ist-date.js";
import { DomainError } from "./domain.js";
import { HttpError } from "../../shared/context.js";
import { financeBudgets, financeHeads } from "./schema.js";

export const NO_BUDGET_PROVISION = "NO_BUDGET_PROVISION";

/**
 * Journal types that never draw on a budget provision: non-cash book entries (depreciation, disposal,
 * capitalisation), stores movements (the budget head is charged when the GRN bill is passed), year-end / opening
 * entries. A reversal (contra with reversesId) only undoes a posting that was already checked.
 */
export const PROVISION_EXEMPT_TYPES: ReadonlySet<string> = new Set([
  "depreciation", "asset_disposal", "asset_acquisition", "inventory_movement", "opening_balance", "closing", "year_end",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when a DEBIT on this head, in a journal of this type, needs a budget provision for the FY. */
export function needsBudgetProvision(
  head: { code: string | null; classification: string | null },
  journal: { type: string; reversesId?: string | null | undefined },
): boolean {
  if (journal.reversesId) return false;
  if (PROVISION_EXEMPT_TYPES.has(journal.type)) return false;
  return headNatureOf(head.code, head.classification) === "expense";
}

export function noBudgetProvisionError(headCode: string, fy: string): DomainError {
  return new DomainError(
    NO_BUDGET_PROVISION,
    `no budget provision for head ${headCode} in financial year ${fy}: expenditure cannot be booked against a head that has no budget provision for the year (GFR); make a provision (budget estimate, supplementary grant or re-appropriation) first`,
  );
}

/**
 * Every expenditure head among `refs` (head ids or codes) must have a budget row for the FY of `date` (YYYY-MM-DD,
 * IST). Throws the NO_BUDGET_PROVISION DomainError naming the first head without one. Unknown refs are left to the
 * posting path (it answers UNKNOWN_ACCOUNT_CODE). Runs in the caller transaction (tenant-scoped, RLS).
 */
export async function assertProvisionTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any, tenantId: string, refs: readonly string[], date: string, journalType: string, reversesId?: string | null,
): Promise<void> {
  const wanted = [...new Set(refs.filter((r) => typeof r === "string" && r.trim() !== ""))];
  if (wanted.length === 0) return;
  const fy = fyOfDate(date);
  const ids = wanted.filter((r) => UUID_RE.test(r));
  const codes = wanted.filter((r) => !UUID_RE.test(r));
  type Head = typeof financeHeads.$inferSelect;
  const heads: Head[] = [
    ...(ids.length ? await tx.select().from(financeHeads).where(and(eq(financeHeads.tenantId, tenantId), inArray(financeHeads.id, ids))) : []),
    ...(codes.length ? await tx.select().from(financeHeads).where(and(eq(financeHeads.tenantId, tenantId), inArray(financeHeads.code, codes))) : []),
  ];
  const expenditure = heads.filter((h) => needsBudgetProvision(h, { type: journalType, reversesId }));
  if (expenditure.length === 0) return;
  const budgets: Array<{ headId: string }> = await tx.select({ headId: financeBudgets.headId }).from(financeBudgets).where(and(
    eq(financeBudgets.tenantId, tenantId), eq(financeBudgets.fy, fy), inArray(financeBudgets.headId, expenditure.map((h) => h.id)),
  ));
  const provided = new Set(budgets.map((b) => b.headId));
  const missing = expenditure.find((h) => !provided.has(h.id));
  if (missing) throw noBudgetProvisionError(missing.code, fy);
}

/** Synchronous pre-check for the HTTP routes (same rule as assertProvisionTx, in its own tenant-scoped read). */
export async function assertProvisionSync(
  tenantId: string, refs: readonly string[], date: string, journalType: string, reversesId?: string | null,
): Promise<void> {
  await scopedRead((tx) => assertProvisionTx(tx, tenantId, refs, date, journalType, reversesId));
}

/**
 * The HTTP form: a missing provision is a 422 NO_BUDGET_PROVISION (the web error catalogue words it in en/hi), with a
 * field error on `field` so the form can point at the head.
 */
export async function assertProvisionHttp(
  tenantId: string, refs: readonly string[], date: string, journalType: string, field = "headId",
): Promise<void> {
  try {
    await assertProvisionSync(tenantId, refs, date, journalType);
  } catch (err) {
    if (err instanceof DomainError && err.code === NO_BUDGET_PROVISION) {
      throw new HttpError(422, NO_BUDGET_PROVISION, err.message.replace(/^\[[A-Z_]+\]\s*/, ""), [
        { field, message: "This head has no budget provision for the financial year. Ask the budget section to make a provision (budget estimate, supplementary grant or re-appropriation) first." },
      ]);
    }
    throw err;
  }
}
