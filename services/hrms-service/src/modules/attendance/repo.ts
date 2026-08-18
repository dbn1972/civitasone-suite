import { eq, and, inArray } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import {
  hrmsAttendance, hrmsAttendanceRegularisations, hrmsAttendanceLocks, hrmsShifts,
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
  await (tx as typeof db).insert(hrmsAttendance).values(row) // tx may be a transaction or the db pool
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

export async function insertRegularisation(tx: Writer, row: typeof hrmsAttendanceRegularisations.$inferInsert): Promise<void> {
  await tx.insert(hrmsAttendanceRegularisations).values(row);
}

/** PPL-D1 fix: update a pending regularisation to approved or rejected.
 * Accepts a drizzle tx so the caller can enqueue an outbox event atomically.
 * Returns the updated row (with employeeId and date) or null if not found / already decided.
 */
export async function updateRegularisationStatus(
  tx: Writer,
  tenantId: string, id: string, status: "approved" | "rejected", actorId: string, reason?: string,
): Promise<{ id: string; employeeId: string; date: string } | null> {
  // Atomic: WHERE status='pending' guards against concurrent approve/reject races.
  const updated = await tx.update(hrmsAttendanceRegularisations)
    .set({ status, updatedBy: actorId, updatedAt: new Date(), ...(reason ? { reason } : {}) })
    .where(and(
      eq(hrmsAttendanceRegularisations.tenantId, tenantId),
      eq(hrmsAttendanceRegularisations.id, id),
      eq(hrmsAttendanceRegularisations.status, "pending"),
    ))
    .returning({
      id: hrmsAttendanceRegularisations.id,
      employeeId: hrmsAttendanceRegularisations.employeeId,
      date: hrmsAttendanceRegularisations.date,
    });
  return updated[0] ?? null;
}

/** Checkin-log: attendance rows with inTime/outTime formatted for the UI. */
export async function listCheckinLog(tenantId: string, limit = 200) {
  const rows = await scopedRead((tx) =>
    tx.select().from(hrmsAttendance)
      .where(eq(hrmsAttendance.tenantId, tenantId))
      .limit(limit)
  );
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employee: r.employeeId.slice(0, 8),
    department: "",
    date: r.attendanceDate,
    checkIn: r.inTime ?? null,
    checkOut: r.outTime ?? null,
    source: r.source,
    totalHours: (r.inTime && r.outTime)
      ? (() => {
          const [ih, im] = r.inTime.split(":").map(Number) as [number, number];
          const [oh, om] = r.outTime!.split(":").map(Number) as [number, number];
          let mins = (oh * 60 + om) - (ih * 60 + im);
          if (mins < 0) mins += 1440; // cross-midnight shift
          return mins > 0 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : "—";
        })()
      : "—",
  }));
}

/** List shift definitions for a tenant. */
export async function listShifts(tenantId: string) {
  const rows = await scopedRead((tx) =>
    tx.select().from(hrmsShifts).where(eq(hrmsShifts.tenantId, tenantId))
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    startTime: r.startTime,
    endTime: r.endTime,
    breakDuration: r.graceMins ? `${r.graceMins} min grace` : "—",
    workingHours: (() => {
      const [sh, sm] = r.startTime.split(":").map(Number) as [number, number];
      const [eh, em] = r.endTime.split(":").map(Number) as [number, number];
      const mins = (eh * 60 + em) - (sh * 60 + sm);
      return mins > 0 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : "—";
    })(),
    applicableTo: "All",
    status: "active",
  }));
}

// ── DEF-AT-001: attendance period lock ─────────────────────────────────────

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

export async function upsertLock(
  tx: Writer,
  row: {
    id: string; tenantId: string; period: string; status: "locked" | "open";
    reason: string | null; actorId: string; at: Date;
  },
): Promise<void> {
  await (tx as typeof db).insert(hrmsAttendanceLocks).values({ // tx may be a transaction or the db pool
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
