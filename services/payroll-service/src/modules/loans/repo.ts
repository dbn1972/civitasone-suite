import { eq, and, inArray, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { payrollLoans, payrollLoanRepayments, type LoanRow } from "./schema.js";
// BUG-1 (payroll loans EMI cap): reads payroll's own gross-pay history to
// evaluate the cap. Cross-module reads within this service are an
// established pattern in the other direction already -- payroll/consumer.ts
// imports this very file (`import * as loansRepo from "../loans/repo.js"`)
// for its own per-employee loan lookups -- and both schemas are combined
// into the one `db` in shared/db.ts regardless of which module directory
// they live in.
import { payrollSlips } from "../payroll/schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findLoanById(id: string, tenantId: string): Promise<LoanRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(payrollLoans)
    .where(and(eq(payrollLoans.id, id), eq(payrollLoans.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

export async function findLoansByEmployee(tenantId: string, employeeId: string, limit = 200): Promise<LoanRow[]> {
  return scopedRead((tx) => tx.select().from(payrollLoans)
    .where(and(eq(payrollLoans.tenantId, tenantId), eq(payrollLoans.employeeId, employeeId)))
    .limit(limit));
}

/**
 * Tx-scoped variant of findLoansByEmployee: reads through the caller'''s
 * already-open transaction instead of opening a nested one via scopedRead.
 * payroll/consumer.ts'''s payroll-run computation loop calls this once PER
 * EMPLOYEE from inside its own open db.transaction() -- the scopedRead-based
 * version there opens a SECOND transaction competing for a connection from
 * the same pool as the outer one, deadlocking every in-flight payroll-run
 * computation once concurrency reaches pool.max (see
 * .claude/skills/16-production-readiness-audit.md section 1).
 */
export async function findLoansByEmployeeTx(tx: Writer, tenantId: string, employeeId: string, limit = 200): Promise<LoanRow[]> {
  return (tx as typeof db).select().from(payrollLoans)
    .where(and(eq(payrollLoans.tenantId, tenantId), eq(payrollLoans.employeeId, employeeId)))
    .limit(limit);
}

/**
 * PERF-021 (Site A): batched sibling of findLoansByEmployeeTx for
 * payroll/consumer.ts's processPayrollRun, which previously called
 * findLoansByEmployeeTx once PER EMPLOYEE from inside its own already-open
 * outer db.transaction(). findLoansByEmployeeTx takes no row lock (plain
 * SELECT, no .for("update")) and nothing in that transaction writes
 * `payroll_loans` for any employee OTHER than the one whose own loop
 * iteration is currently running -- so fetching every run-employee's loans
 * once, up front, is safe: no employee's loan rows are touched by another
 * employee's turn. Reads through the caller's tx, same deadlock-avoidance
 * reasoning as findLoansByEmployeeTx itself (see its own comment above).
 *
 * The original per-employee query has no ORDER BY (so "first `limit`
 * rows" was already implementation-defined even before this change) and
 * caps at `limit` (default 200) PER EMPLOYEE. A single query cannot apply
 * a per-group LIMIT, so this fetches every matching row for the whole
 * employee set and slices each employee's own list down to `limit`
 * in-process -- preserving the "at most `limit` loans per employee"
 * contract exactly, including in the pathological case of one employee
 * having more than `limit` active loans.
 */
export async function findLoansByEmployeesTx(
  tx: Writer,
  tenantId: string,
  employeeIds: string[],
  limit = 200,
): Promise<Map<string, LoanRow[]>> {
  const result = new Map<string, LoanRow[]>();
  if (employeeIds.length === 0) return result;
  const rows = await (tx as typeof db).select().from(payrollLoans)
    .where(and(eq(payrollLoans.tenantId, tenantId), inArray(payrollLoans.employeeId, employeeIds)));
  for (const row of rows) {
    let list = result.get(row.employeeId);
    if (!list) { list = []; result.set(row.employeeId, list); }
    if (list.length < limit) list.push(row);
  }
  return result;
}

/**
 * BUG-1 (payroll loans EMI cap): the employee's most recently computed
 * payroll gross, used as the affordability base for the combined-EMI cap
 * (see policy.ts). Returns null when the employee has no payroll_slips row
 * yet (e.g. a brand-new hire's very first loan application) -- policy.ts
 * documents how that case is handled.
 */
export async function findLatestGrossMinorForEmployee(tenantId: string, employeeId: string): Promise<bigint | null> {
  const rows = await scopedRead((tx) => tx.select({ grossMinor: payrollSlips.grossMinor }).from(payrollSlips)
    .where(and(eq(payrollSlips.tenantId, tenantId), eq(payrollSlips.employeeId, employeeId)))
    .orderBy(desc(payrollSlips.createdAt))
    .limit(1));
  return rows[0]?.grossMinor ?? null;
}

/** Tx-scoped variant of findLatestGrossMinorForEmployee -- see findLoansByEmployeeTx's doc comment above for why the consumer needs the tx-scoped form (reads through the caller's own open transaction rather than opening a competing one). */
export async function findLatestGrossMinorForEmployeeTx(tx: Writer, tenantId: string, employeeId: string): Promise<bigint | null> {
  const rows = await (tx as typeof db).select({ grossMinor: payrollSlips.grossMinor }).from(payrollSlips)
    .where(and(eq(payrollSlips.tenantId, tenantId), eq(payrollSlips.employeeId, employeeId)))
    .orderBy(desc(payrollSlips.createdAt))
    .limit(1);
  return rows[0]?.grossMinor ?? null;
}

export async function insertLoan(tx: Writer, row: typeof payrollLoans.$inferInsert): Promise<void> {
  await tx.insert(payrollLoans).values(row);
}

export async function updateLoan(tx: Writer, id: string, patch: Partial<typeof payrollLoans.$inferInsert>): Promise<void> {
  await tx.update(payrollLoans).set({ ...patch, updatedAt: new Date() }).where(eq(payrollLoans.id, id));
}

export async function findLoanByIdTx(tx: Writer, id: string): Promise<LoanRow | null> {
  const rows = await (tx as typeof db).select().from(payrollLoans).where(eq(payrollLoans.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertRepayment(tx: Writer, row: typeof payrollLoanRepayments.$inferInsert): Promise<void> {
  await tx.insert(payrollLoanRepayments).values(row);
}

export async function countRepayments(tx: Writer, loanId: string): Promise<number> {
  const rows = await (tx as typeof db).select().from(payrollLoanRepayments).where(eq(payrollLoanRepayments.loanId, loanId)).limit(500);
  return rows.length;
}
