import { eq, and } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { payrollLoans, payrollLoanRepayments, type LoanRow } from "./schema.js";

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
