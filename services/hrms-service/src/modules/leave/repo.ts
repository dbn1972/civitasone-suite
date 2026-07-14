import { eq, and, gte, sql } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import {
  hrmsLeaveTypes, hrmsLeaveAllocs, hrmsLeaveApps,
  type LeaveAppRow, type LeaveAllocRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findAllocById(id: string): Promise<LeaveAllocRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsLeaveAllocs).where(eq(hrmsLeaveAllocs.id, id)).limit(1));
  return rows[0] ?? null;
}

export async function findAllocByEmpAndType(
  tenantId: string, employeeId: string, leaveTypeId: string, fy: string
): Promise<LeaveAllocRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsLeaveAllocs)
    .where(and(
      eq(hrmsLeaveAllocs.tenantId, tenantId),
      eq(hrmsLeaveAllocs.employeeId, employeeId),
      eq(hrmsLeaveAllocs.leaveTypeId, leaveTypeId),
      eq(hrmsLeaveAllocs.fy, fy),
    )).limit(1));
  return rows[0] ?? null;
}

export async function findLeaveAppById(id: string, tenantId: string): Promise<LeaveAppRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsLeaveApps)
    .where(and(eq(hrmsLeaveApps.id, id), eq(hrmsLeaveApps.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

export async function findLeaveAppsByEmp(tenantId: string, employeeId: string, limit = 100): Promise<LeaveAppRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsLeaveApps)
    .where(and(eq(hrmsLeaveApps.tenantId, tenantId), eq(hrmsLeaveApps.employeeId, employeeId)))
    .limit(limit));
}

export async function findLeaveAppsByTenant(tenantId: string, limit = 100): Promise<LeaveAppRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsLeaveApps)
    .where(eq(hrmsLeaveApps.tenantId, tenantId))
    .limit(limit));
}

export async function listLeaveTypesByTenant(tenantId: string, limit = 100): Promise<Array<typeof hrmsLeaveTypes.$inferSelect>> {
  return scopedRead((tx) => tx.select().from(hrmsLeaveTypes).where(eq(hrmsLeaveTypes.tenantId, tenantId)).limit(limit));
}

export async function listAllocsForEmployee(tenantId: string, employeeId: string, limit = 200): Promise<LeaveAllocRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsLeaveAllocs)
    .where(and(eq(hrmsLeaveAllocs.tenantId, tenantId), eq(hrmsLeaveAllocs.employeeId, employeeId)))
    .limit(limit));
}

export async function findApprovedLeaveInMonth(tenantId: string, month: string): Promise<LeaveAppRow[]> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsLeaveApps)
    .where(and(eq(hrmsLeaveApps.tenantId, tenantId), eq(hrmsLeaveApps.status, "approved")))
    .limit(500));
  return rows.filter((r) => (r.fromDate ?? "").startsWith(month) || (r.toDate ?? "").startsWith(month));
}

export async function insertLeaveType(tx: Writer, row: typeof hrmsLeaveTypes.$inferInsert): Promise<void> {
  await tx.insert(hrmsLeaveTypes).values(row);
}

export async function insertLeaveAlloc(tx: Writer, row: typeof hrmsLeaveAllocs.$inferInsert): Promise<void> {
  await tx.insert(hrmsLeaveAllocs).values(row);
}

export async function insertLeaveApp(tx: Writer, row: typeof hrmsLeaveApps.$inferInsert): Promise<void> {
  await tx.insert(hrmsLeaveApps).values(row);
}

export async function updateLeaveApp(tx: Writer, id: string, patch: Partial<typeof hrmsLeaveApps.$inferInsert>): Promise<void> {
  await tx.update(hrmsLeaveApps).set({ ...patch, updatedAt: new Date() }).where(eq(hrmsLeaveApps.id, id));
}

export async function debitLeaveBalance(tx: Writer, allocId: string, days: number): Promise<void> {
  // H7 FIX: Guarded atomic UPDATE prevents lost updates under concurrency.
  // WHERE balance_days >= days ensures we never go negative; RETURNING confirms success.
  // If no rows are updated, the balance was insufficient (concurrent approval drained it).
  const result = await tx.update(hrmsLeaveAllocs)
    .set({
      balanceDays: sql`${hrmsLeaveAllocs.balanceDays} - ${days}`,
      updatedAt: new Date(),
    })
    .where(and(eq(hrmsLeaveAllocs.id, allocId), gte(hrmsLeaveAllocs.balanceDays, days)))
    .returning({ balanceDays: hrmsLeaveAllocs.balanceDays });
  if (result.length === 0) {
    throw new Error(`INSUFFICIENT_LEAVE_BALANCE: allocation ${allocId} has fewer than ${days} days remaining`);
  }
}

export async function creditLeaveBalance(tx: Writer, allocId: string, days: number): Promise<void> {
  // H7 FIX: Atomic credit (no read-modify-write). Safe under concurrency.
  await tx.update(hrmsLeaveAllocs)
    .set({
      balanceDays: sql`${hrmsLeaveAllocs.balanceDays} + ${days}`,
      updatedAt: new Date(),
    })
    .where(eq(hrmsLeaveAllocs.id, allocId));
}
