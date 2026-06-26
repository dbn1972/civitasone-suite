import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { payrollLoans, payrollLoanRepayments, type LoanRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findLoanById(id: string, tenantId: string): Promise<LoanRow | null> {
  const rows = await db.select().from(payrollLoans)
    .where(and(eq(payrollLoans.id, id), eq(payrollLoans.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findLoansByEmployee(tenantId: string, employeeId: string, limit = 200): Promise<LoanRow[]> {
  return db.select().from(payrollLoans)
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
