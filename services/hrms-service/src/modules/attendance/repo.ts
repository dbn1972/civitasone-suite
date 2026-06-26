import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  hrmsAttendance, hrmsAttendanceRegularisations,
  type AttendanceRow, type AttendanceInsert, type RegularisationRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function listByTenant(tenantId: string, limit = 200): Promise<AttendanceRow[]> {
  return db.select().from(hrmsAttendance)
    .where(eq(hrmsAttendance.tenantId, tenantId))
    .limit(limit);
}

export async function findByEmpAndMonth(tenantId: string, employeeId: string, month: string): Promise<AttendanceRow[]> {
  const rows = await db.select().from(hrmsAttendance)
    .where(and(
      eq(hrmsAttendance.tenantId, tenantId),
      eq(hrmsAttendance.employeeId, employeeId),
    ))
    .limit(500);
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
  return db.select().from(hrmsAttendanceRegularisations)
    .where(eq(hrmsAttendanceRegularisations.tenantId, tenantId))
    .limit(limit);
}
