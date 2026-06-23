import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  hrmsLeaveTypes, hrmsLeaveAllocs, hrmsLeaveApps,
  type LeaveAppRow, type LeaveAllocRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findAllocById(id: string): Promise<LeaveAllocRow | null> {
  const rows = await db.select().from(hrmsLeaveAllocs).where(eq(hrmsLeaveAllocs.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findAllocByEmpAndType(
  tenantId: string, employeeId: string, leaveTypeId: string, fy: string
): Promise<LeaveAllocRow | null> {
  const rows = await db.select().from(hrmsLeaveAllocs)
    .where(and(
      eq(hrmsLeaveAllocs.tenantId, tenantId),
      eq(hrmsLeaveAllocs.employeeId, employeeId),
      eq(hrmsLeaveAllocs.leaveTypeId, leaveTypeId),
      eq(hrmsLeaveAllocs.fy, fy),
    )).limit(1);
  return rows[0] ?? null;
}

export async function findLeaveAppById(id: string, tenantId: string): Promise<LeaveAppRow | null> {
  const rows = await db.select().from(hrmsLeaveApps)
    .where(and(eq(hrmsLeaveApps.id, id), eq(hrmsLeaveApps.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findLeaveAppsByEmp(tenantId: string, employeeId: string, limit = 100): Promise<LeaveAppRow[]> {
  return db.select().from(hrmsLeaveApps)
    .where(and(eq(hrmsLeaveApps.tenantId, tenantId), eq(hrmsLeaveApps.employeeId, employeeId)))
    .limit(limit);
}

export async function findLeaveAppsByTenant(tenantId: string, limit = 100): Promise<LeaveAppRow[]> {
  return db.select().from(hrmsLeaveApps)
    .where(eq(hrmsLeaveApps.tenantId, tenantId))
    .limit(limit);
}

export async function listLeaveTypesByTenant(tenantId: string): Promise<Array<typeof hrmsLeaveTypes.$inferSelect>> {
  return db.select().from(hrmsLeaveTypes).where(eq(hrmsLeaveTypes.tenantId, tenantId));
}

export async function listAllocsForEmployee(tenantId: string, employeeId: string): Promise<LeaveAllocRow[]> {
  return db.select().from(hrmsLeaveAllocs)
    .where(and(eq(hrmsLeaveAllocs.tenantId, tenantId), eq(hrmsLeaveAllocs.employeeId, employeeId)));
}

export async function findApprovedLeaveInMonth(tenantId: string, month: string): Promise<LeaveAppRow[]> {
  const rows = await db.select().from(hrmsLeaveApps)
    .where(and(eq(hrmsLeaveApps.tenantId, tenantId), eq(hrmsLeaveApps.status, "approved")));
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
  const rows = await (tx as typeof db).select({ balanceDays: hrmsLeaveAllocs.balanceDays })
    .from(hrmsLeaveAllocs).where(eq(hrmsLeaveAllocs.id, allocId)).limit(1);
  const current = rows[0]?.balanceDays ?? 0;
  await tx.update(hrmsLeaveAllocs)
    .set({ balanceDays: current - days, updatedAt: new Date() })
    .where(eq(hrmsLeaveAllocs.id, allocId));
}

export async function creditLeaveBalance(tx: Writer, allocId: string, days: number): Promise<void> {
  const rows = await (tx as typeof db).select({ balanceDays: hrmsLeaveAllocs.balanceDays })
    .from(hrmsLeaveAllocs).where(eq(hrmsLeaveAllocs.id, allocId)).limit(1);
  const current = rows[0]?.balanceDays ?? 0;
  await tx.update(hrmsLeaveAllocs)
    .set({ balanceDays: current + days, updatedAt: new Date() })
    .where(eq(hrmsLeaveAllocs.id, allocId));
}
