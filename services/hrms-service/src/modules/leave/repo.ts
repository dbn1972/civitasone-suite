import { eq, and, gte, lte, inArray, ne, sql } from "drizzle-orm";
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

/** Tx-scoped variant of findAllocById -- see .claude/skills/16-production-readiness-audit.md section 1. */
export async function findAllocByIdTx(tx: Writer, id: string): Promise<LeaveAllocRow | null> {
  const rows = await (tx as typeof db).select().from(hrmsLeaveAllocs).where(eq(hrmsLeaveAllocs.id, id)).limit(1);
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

/** Tx-scoped variant of findLeaveAppById -- see .claude/skills/16-production-readiness-audit.md section 1. */
export async function findLeaveAppByIdTx(tx: Writer, id: string, tenantId: string): Promise<LeaveAppRow | null> {
  const rows = await (tx as typeof db).select().from(hrmsLeaveApps)
    .where(and(eq(hrmsLeaveApps.id, id), eq(hrmsLeaveApps.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findLeaveAppsByEmp(tenantId: string, employeeId: string, limit = 100): Promise<LeaveAppRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsLeaveApps)
    .where(and(eq(hrmsLeaveApps.tenantId, tenantId), eq(hrmsLeaveApps.employeeId, employeeId)))
    .limit(limit));
}

export async function findLeaveAppsByTenant(tenantId: string, limit = 100, offset = 0): Promise<LeaveAppRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsLeaveApps)
    .where(eq(hrmsLeaveApps.tenantId, tenantId))
    .limit(limit).offset(offset));
}

export async function listLeaveTypesByTenant(tenantId: string, limit = 100): Promise<Array<typeof hrmsLeaveTypes.$inferSelect>> {
  return scopedRead((tx) => tx.select().from(hrmsLeaveTypes).where(eq(hrmsLeaveTypes.tenantId, tenantId)).limit(limit));
}

export async function listAllocsForEmployee(tenantId: string, employeeId: string, limit = 200): Promise<LeaveAllocRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsLeaveAllocs)
    .where(and(eq(hrmsLeaveAllocs.tenantId, tenantId), eq(hrmsLeaveAllocs.employeeId, employeeId)))
    .limit(limit));
}

/**
 * DEF-LM-002 (T&A-LM-0283): Find leave applications for the same employee whose
 * date range overlaps [fromDate, toDate]. Only ACTIVE applications block a new
 * one — pending (awaiting approval) and approved. Rejected/cancelled/draft
 * applications never conflict. Two ranges overlap when
 * existing.fromDate <= new.toDate AND existing.toDate >= new.fromDate.
 * Dates are stored as ISO `date` (YYYY-MM-DD) so lexical comparison is correct.
 * An optional excludeId lets callers ignore a specific application (e.g. when
 * re-validating an edit of the same record).
 */
export async function findOverlappingLeaveApps(
  tenantId: string,
  employeeId: string,
  fromDate: string,
  toDate: string,
  excludeId?: string,
): Promise<LeaveAppRow[]> {
  return scopedRead((tx) => {
    const conditions = [
      eq(hrmsLeaveApps.tenantId, tenantId),
      eq(hrmsLeaveApps.employeeId, employeeId),
      inArray(hrmsLeaveApps.status, ["pending", "approved"]),
      lte(hrmsLeaveApps.fromDate, toDate),
      gte(hrmsLeaveApps.toDate, fromDate),
    ];
    if (excludeId) conditions.push(ne(hrmsLeaveApps.id, excludeId));
    return tx.select().from(hrmsLeaveApps).where(and(...conditions)).limit(50);
  });
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

/**
 * H2 — Race-safe approve: update only if current status is still 'pending'.
 * Returns the number of rows updated (1 = success, 0 = already processed by
 * another worker). Callers must check the return value and throw
 * LEAVE_ALREADY_PROCESSED when 0 to prevent double-approval under concurrency.
 */
export async function approveLeaveApp(tx: Writer, id: string, patch: Partial<typeof hrmsLeaveApps.$inferInsert>): Promise<number> {
  const result = await tx.update(hrmsLeaveApps)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(hrmsLeaveApps.id, id), eq(hrmsLeaveApps.status, "pending")))
    .returning({ id: hrmsLeaveApps.id });
  return result.length;
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
