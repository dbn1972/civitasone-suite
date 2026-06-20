import { eq, and, sql, ne, or } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import { hrmsLeaveApps } from "../leave/schema.js";
import { hrmsAttendance } from "../attendance/schema.js";

export async function getDashboard(tenantId: string): Promise<{
  headcount: number;
  attendanceTodayPct: number;
  pendingLeaves: number;
  payrollDue: number;
}> {
  const today = new Date().toISOString().slice(0, 10);

  const [headcountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.tenantId, tenantId), ne(hrmsEmployees.status, "separated")));

  const [pendingRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(hrmsLeaveApps)
    .where(and(
      eq(hrmsLeaveApps.tenantId, tenantId),
      or(eq(hrmsLeaveApps.status, "pending"), eq(hrmsLeaveApps.status, "draft")),
    ));

  const [presentRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(hrmsAttendance)
    .where(and(
      eq(hrmsAttendance.tenantId, tenantId),
      eq(hrmsAttendance.attendanceDate, today),
      eq(hrmsAttendance.status, "present"),
    ));

  const headcount = headcountRow?.count ?? 0;
  const present = presentRow?.count ?? 0;

  return {
    headcount,
    attendanceTodayPct: headcount > 0 ? Math.round((present / headcount) * 100) : 0,
    pendingLeaves: pendingRow?.count ?? 0,
    payrollDue: 0,
  };
}
