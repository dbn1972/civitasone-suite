import { eq, and, inArray, sql } from "drizzle-orm";
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
  return scopedRead((tx) => getLopForMonthTx(tx, tenantId, employeeId, month));
}

/** Tx-scoped twin of getLopForMonth for callers already inside an open transaction. */
export async function getLopForMonthTx(
  tx: Writer,
  tenantId: string,
  employeeId: string,
  month: string,
): Promise<{ hasLedger: boolean; days: number }> {
  const [row] = await tx.select({
    cnt: sql<number>`count(*)::int`,
    total: sql<number>`coalesce(sum(${payrollLopLedger.lopDays}), 0)::int`,
  })
    .from(payrollLopLedger)
    .where(and(
      eq(payrollLopLedger.tenantId, tenantId),
      eq(payrollLopLedger.employeeId, employeeId),
      eq(payrollLopLedger.month, month),
    ));
  return { hasLedger: (row?.cnt ?? 0) > 0, days: row?.total ?? 0 };
}

/**
 * PERF-021 (Site A): batched sibling of getLopForMonthTx for
 * payroll/consumer.ts's processPayrollRun, which previously called
 * getLopForMonthTx once PER EMPLOYEE from inside its own already-open outer
 * db.transaction() -- an O(N) read for reference data
 * (`payroll_lop_ledger`, fed by leave/attendance events) that nothing in
 * that transaction writes, so it is safe to read once for every employee in
 * the run instead of once per employee. Reads through the caller's tx, same
 * as getLopForMonthTx (see its sibling's "tenantTransaction re-audit" /
 * salary-revision-tenanttransaction-nested-tx-deadlock.test.ts history --
 * a bare db.execute()/scopedRead() here would reintroduce that exact
 * nested-connection deadlock class, just moved from N call sites to 1).
 *
 * GROUP BY only returns a row for employee ids that actually have ledger
 * rows for the month, so an employee id with none is simply absent from the
 * returned Map -- callers must default a miss to { hasLedger: false, days: 0 },
 * exactly what getLopForMonthTx returns for that same "no rows" case (its
 * bare aggregate, with no GROUP BY, always returns exactly one row with
 * cnt=0/total=0 rather than zero rows).
 */
export async function getLopForMonthsTx(
  tx: Writer,
  tenantId: string,
  employeeIds: string[],
  month: string,
): Promise<Map<string, { hasLedger: boolean; days: number }>> {
  const result = new Map<string, { hasLedger: boolean; days: number }>();
  if (employeeIds.length === 0) return result;
  const rows = await tx.select({
    employeeId: payrollLopLedger.employeeId,
    cnt: sql<number>`count(*)::int`,
    total: sql<number>`coalesce(sum(${payrollLopLedger.lopDays}), 0)::int`,
  })
    .from(payrollLopLedger)
    .where(and(
      eq(payrollLopLedger.tenantId, tenantId),
      inArray(payrollLopLedger.employeeId, employeeIds),
      eq(payrollLopLedger.month, month),
    ))
    .groupBy(payrollLopLedger.employeeId);
  for (const row of rows) {
    result.set(row.employeeId, { hasLedger: row.cnt > 0, days: row.total });
  }
  return result;
}
