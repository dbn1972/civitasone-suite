import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { payrollLopLedger } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function upsertLopDays(
  tx: Writer,
  tenantId: string,
  employeeId: string,
  month: string,
  source: string,
  addDays: number,
): Promise<void> {
  const existing = await (tx as typeof db).select().from(payrollLopLedger)
    .where(and(
      eq(payrollLopLedger.tenantId, tenantId),
      eq(payrollLopLedger.employeeId, employeeId),
      eq(payrollLopLedger.month, month),
      eq(payrollLopLedger.source, source),
    )).limit(1);
  if (existing[0]) {
    await tx.update(payrollLopLedger)
      .set({ lopDays: existing[0].lopDays + addDays, updatedAt: new Date() })
      .where(eq(payrollLopLedger.id, existing[0].id));
  } else {
    await tx.insert(payrollLopLedger).values({
      tenantId, employeeId, month, source, lopDays: addDays,
    });
  }
}

export async function sumLopDays(tenantId: string, employeeId: string, month: string): Promise<number> {
  const [row] = await scopedRead((tx) => tx.select({ total: sql<number>`coalesce(sum(${payrollLopLedger.lopDays}), 0)::int` })
    .from(payrollLopLedger)
    .where(and(
      eq(payrollLopLedger.tenantId, tenantId),
      eq(payrollLopLedger.employeeId, employeeId),
      eq(payrollLopLedger.month, month),
    )));
  return row?.total ?? 0;
}

/**
 * M2 (LOP double-count): return both the count of local ledger rows and the
 * summed LOP days for an (employee, month). The caller uses `hasLedger` to pick
 * an authoritative source: when a local ledger entry exists for the month, the
 * ledger is authoritative and the HRMS feed (`input.lopDays`) is ignored for
 * that employee; otherwise the HRMS feed is used. This guarantees the same LOP
 * is never deducted twice (once from each source).
 */
export async function getLopForMonth(
  tenantId: string,
  employeeId: string,
  month: string,
): Promise<{ hasLedger: boolean; days: number }> {
  const [row] = await scopedRead((tx) => tx.select({
    cnt: sql<number>`count(*)::int`,
    total: sql<number>`coalesce(sum(${payrollLopLedger.lopDays}), 0)::int`,
  })
    .from(payrollLopLedger)
    .where(and(
      eq(payrollLopLedger.tenantId, tenantId),
      eq(payrollLopLedger.employeeId, employeeId),
      eq(payrollLopLedger.month, month),
    )));
  return { hasLedger: (row?.cnt ?? 0) > 0, days: row?.total ?? 0 };
}
