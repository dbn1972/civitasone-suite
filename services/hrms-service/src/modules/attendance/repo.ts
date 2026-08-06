import { eq, and, inArray } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import {
  hrmsAttendance, hrmsAttendanceRegularisations, hrmsAttendanceLocks,
  type AttendanceRow, type AttendanceInsert, type RegularisationRow, type AttendanceLockRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function listByTenant(tenantId: string, limit = 200): Promise<AttendanceRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsAttendance)
    .where(eq(hrmsAttendance.tenantId, tenantId))
    .limit(limit));
}

export async function findByEmpAndMonth(tenantId: string, employeeId: string, month: string): Promise<AttendanceRow[]> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsAttendance)
    .where(and(
      eq(hrmsAttendance.tenantId, tenantId),
      eq(hrmsAttendance.employeeId, employeeId),
    ))
    .limit(500));
  return rows.filter((r) => (r.attendanceDate ?? "").startsWith(month));
}

export async function insertAttendance(tx: Writer, row: AttendanceInsert): Promise<void> {
  await tx.insert(hrmsAttendance).values(row);
}

export async function upsertAttendance(tx: Writer, row: AttendanceInsert): Promise<void> {
  await (tx as typeof db).insert(hrmsAttendance).values(row)
    .onConflictDoUpdate({
      target: [hrmsAttendance.tenantId, hrmsAttendance.employeeId, hrmsAttendance.attendanceDate],
      set: {
        status:   row.status ?? "present",
        inTime:   row.inTime ?? null,
        outTime:  row.outTime ?? null,
        lateMins: row.lateMins ?? 0,
        updatedAt: new Date(),
      },
    });
}

export async function listRegularisationsByTenant(tenantId: string, limit = 100): Promise<RegularisationRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsAttendanceRegularisations)
    .where(eq(hrmsAttendanceRegularisations.tenantId, tenantId))
    .limit(limit));
}

export async function findRegularisationById(tenantId: string, id: string): Promise<RegularisationRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsAttendanceRegularisations)
    .where(and(
      eq(hrmsAttendanceRegularisations.tenantId, tenantId),
      eq(hrmsAttendanceRegularisations.id, id),
    ))
    .limit(1));
  return rows[0] ?? null;
}

/** Pending-only status flip; returns false when the row was already decided or missing. */
export async function setRegularisationStatus(
  tx: Writer,
  tenantId: string,
  id: string,
  status: string,
  actorId: string,
): Promise<boolean> {
  const rows = await tx.update(hrmsAttendanceRegularisations)
    .set({ status, updatedBy: actorId, updatedAt: new Date() })
    .where(and(
      eq(hrmsAttendanceRegularisations.tenantId, tenantId),
      eq(hrmsAttendanceRegularisations.id, id),
      eq(hrmsAttendanceRegularisations.status, "pending"),
    ))
    .returning({ id: hrmsAttendanceRegularisations.id });
  return rows.length > 0;
}

export async function insertRegularisation(tx: Writer, row: typeof hrmsAttendanceRegularisations.$inferInsert): Promise<void> {
  await tx.insert(hrmsAttendanceRegularisations).values(row);
}

// ── DEF-AT-001: attendance period lock ─────────────────────────────────────

/** Return the set of periods (YYYY-MM) that are currently LOCKED for the tenant. */
export async function findLockedPeriods(tenantId: string, periods: string[]): Promise<string[]> {
  if (periods.length === 0) return [];
  const rows = await scopedRead((tx) => tx.select({ period: hrmsAttendanceLocks.period })
    .from(hrmsAttendanceLocks)
    .where(and(
      eq(hrmsAttendanceLocks.tenantId, tenantId),
      eq(hrmsAttendanceLocks.status, "locked"),
      inArray(hrmsAttendanceLocks.period, periods),
    )));
  return rows.map((r) => (r.period ?? "").trim());
}

export async function listLocksByTenant(tenantId: string, limit = 200): Promise<AttendanceLockRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsAttendanceLocks)
    .where(eq(hrmsAttendanceLocks.tenantId, tenantId))
    .limit(limit));
}

/**
 * Idempotent upsert of a period lock state. On conflict (tenant, period) the
 * status/reason/actor are updated — locking then re-opening the same period
 * mutates the single row rather than creating duplicates.
 */
export async function upsertLock(
  tx: Writer,
  row: {
    id: string; tenantId: string; period: string; status: "locked" | "open";
    reason: string | null; actorId: string; at: Date;
  },
): Promise<void> {
  await (tx as typeof db).insert(hrmsAttendanceLocks).values({
    id: row.id, tenantId: row.tenantId, period: row.period, status: row.status,
    reason: row.reason, lockedBy: row.actorId, lockedAt: row.at,
    createdBy: row.actorId, updatedBy: row.actorId,
  }).onConflictDoUpdate({
    target: [hrmsAttendanceLocks.tenantId, hrmsAttendanceLocks.period],
    set: {
      status: row.status, reason: row.reason, lockedBy: row.actorId,
      lockedAt: row.at, updatedBy: row.actorId, updatedAt: new Date(),
    },
  });
}
