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

  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before these reads — bare db.select() calls run with no RLS GUC set,
  // and running one shared transaction (rather than three separate ones)
  // also gives a consistent snapshot across the three counts.
  const { headcountRow, pendingRow, presentRow } = await db.transaction(async (tx) => {
    const [headcountRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, tenantId), ne(hrmsEmployees.status, "separated")));

    const [pendingRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(hrmsLeaveApps)
      .where(and(
        eq(hrmsLeaveApps.tenantId, tenantId),
        or(eq(hrmsLeaveApps.status, "pending"), eq(hrmsLeaveApps.status, "draft")),
      ));

    const [presentRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(hrmsAttendance)
      .where(and(
        eq(hrmsAttendance.tenantId, tenantId),
        eq(hrmsAttendance.attendanceDate, today),
        eq(hrmsAttendance.status, "present"),
      ));

    return { headcountRow, pendingRow, presentRow };
  });

  const headcount = headcountRow?.count ?? 0;
  const present = presentRow?.count ?? 0;

  return {
    headcount,
    attendanceTodayPct: headcount > 0 ? Math.round((present / headcount) * 100) : 0,
    pendingLeaves: pendingRow?.count ?? 0,
    payrollDue: 0,
  };
}
