import { eq, and, sql, ne, or, lt } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { hrmsEmployees, hrmsDepartments } from "../employee/schema.js";
import { hrmsLeaveApps, hrmsLeaveTypes } from "../leave/schema.js";
import { hrmsAttendance } from "../attendance/schema.js";

export async function getDashboard(tenantId: string): Promise<{
  headcount: number;
  headcountLastMonth: number;
  attendanceTodayPct: number;
  pendingLeaves: number;
  onLeave: number;
  payrollDue: number;
  departmentBreakdown: { name: string; count: number }[];
  employeeTypeBreakdown: { name: string; count: number }[];
  routingFailedCount: number;
}> {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const { headcountRow, headcountLastMonthRow, pendingRow, presentRow, onLeaveRow, deptRows, employeeTypeRows, routingFailedRow } =
    await db.transaction(async (tx) => {
      const [headcountRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.tenantId, tenantId), ne(hrmsEmployees.status, "separated")));

      // Approximation: employees who joined before start of this month (proxy for last-month headcount)
      const [headcountLastMonthRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(hrmsEmployees)
        .where(and(
          eq(hrmsEmployees.tenantId, tenantId),
          ne(hrmsEmployees.status, "separated"),
          lt(hrmsEmployees.dateOfJoining, firstOfMonth),
        ));

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

      const deptRows = await tx
        .select({
          name: hrmsDepartments.name,
          count: sql<number>`count(${hrmsEmployees.id})::int`,
        })
        .from(hrmsEmployees)
        .innerJoin(hrmsDepartments, eq(hrmsEmployees.departmentId, hrmsDepartments.id))
        .where(and(
          eq(hrmsEmployees.tenantId, tenantId),
          ne(hrmsEmployees.status, "separated"),
        ))
        .groupBy(hrmsDepartments.name)
        .orderBy(sql`count(${hrmsEmployees.id}) desc`)
        .limit(7);

      const [onLeaveRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(hrmsEmployees)
        .where(and(
          eq(hrmsEmployees.tenantId, tenantId),
          eq(hrmsEmployees.status, "on_leave"),
        ));

      // Tenant-wide headcount by employeeType (mirrors headcount's "not separated" scope,
      // so per-type counts sum to the same total shown for "All"). Independent of any
      // list-endpoint pagination -- see employees/page.tsx type-tabs.
      const employeeTypeRows = await tx
        .select({
          name: hrmsEmployees.employeeType,
          count: sql<number>`count(*)::int`,
        })
        .from(hrmsEmployees)
        .where(and(
          eq(hrmsEmployees.tenantId, tenantId),
          ne(hrmsEmployees.status, "separated"),
        ))
        .groupBy(hrmsEmployees.employeeType);

      // Leave applications whose workflow instance was rejected (see
      // leave/consumer.ts's WORKFLOW_INSTANCE_REJECTED subscriber) --
      // requests that were never actually routed to anyone and so will
      // never surface via the pendingLeaves count above. Counted
      // separately (not folded into pendingLeaves) so HR sees it as its
      // own distinct, actionable signal rather than an inflated "pending"
      // number with no obvious next step.
      const [routingFailedRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(hrmsLeaveApps)
        .where(and(
          eq(hrmsLeaveApps.tenantId, tenantId),
          eq(hrmsLeaveApps.status, "routing_failed"),
        ));

      return { headcountRow, headcountLastMonthRow, pendingRow, presentRow, onLeaveRow, deptRows, employeeTypeRows, routingFailedRow };
    });

  const headcount = headcountRow?.count ?? 0;
  const present = presentRow?.count ?? 0;

  // Collapse to top 6 + "Others"
  const topDepts = deptRows.slice(0, 6);
  const otherDepts = deptRows.slice(6);
  const othersCount = otherDepts.reduce((s, r) => s + r.count, 0);
  const departmentBreakdown = [
    ...topDepts.map((r) => ({ name: r.name, count: r.count })),
    ...(otherDepts.length > 0
      ? [{ name: `Others (${otherDepts.length} depts)`, count: othersCount }]
      : []),
  ];

  return {
    headcount,
    headcountLastMonth: headcountLastMonthRow?.count ?? 0,
    attendanceTodayPct: headcount > 0 ? Math.round((present / headcount) * 100) : 0,
    pendingLeaves: pendingRow?.count ?? 0,
    onLeave: onLeaveRow?.count ?? 0,
    payrollDue: 0,
    departmentBreakdown,
    employeeTypeBreakdown: employeeTypeRows.map((r) => ({ name: r.name, count: r.count })),
    routingFailedCount: routingFailedRow?.count ?? 0,
  };
}

type LeaveInboxRow = {
  id: string;
  employeeName: string;
  employeeNo: string;
  departmentName: string;
  leaveTypeName: string;
  leaveTypeCode: string;
  fromDate: string;
  toDate: string;
  daysApplied: number;
  status: string;
};

function mapLeaveInboxRow(r: {
  id: string; employeeName: string; employeeNo: string; departmentName: string;
  leaveTypeName: string | null; leaveTypeCode: string | null;
  fromDate: unknown; toDate: unknown; daysApplied: number; status: string;
}): LeaveInboxRow {
  return {
    id: r.id,
    employeeName: r.employeeName,
    employeeNo: r.employeeNo,
    departmentName: r.departmentName,
    leaveTypeName: r.leaveTypeName ?? "Leave",
    leaveTypeCode: r.leaveTypeCode ?? "LV",
    fromDate: typeof r.fromDate === "string" ? r.fromDate : String(r.fromDate),
    toDate: typeof r.toDate === "string" ? r.toDate : String(r.toDate),
    daysApplied: r.daysApplied,
    status: r.status,
  };
}

export async function getPendingLeaveInbox(tenantId: string): Promise<LeaveInboxRow[]> {
  const rows = await db.transaction(async (tx) =>
    tx
      .select({
        id: hrmsLeaveApps.id,
        employeeName: hrmsEmployees.fullName,
        employeeNo: hrmsEmployees.employeeNo,
        departmentName: hrmsDepartments.name,
        leaveTypeName: hrmsLeaveTypes.name,
        leaveTypeCode: hrmsLeaveTypes.code,
        fromDate: hrmsLeaveApps.fromDate,
        toDate: hrmsLeaveApps.toDate,
        daysApplied: hrmsLeaveApps.daysApplied,
        status: hrmsLeaveApps.status,
      })
      .from(hrmsLeaveApps)
      .innerJoin(hrmsEmployees, eq(hrmsLeaveApps.employeeId, hrmsEmployees.id))
      .innerJoin(hrmsDepartments, eq(hrmsEmployees.departmentId, hrmsDepartments.id))
      .innerJoin(hrmsLeaveTypes, eq(hrmsLeaveApps.leaveTypeId, hrmsLeaveTypes.id))
      .where(and(
        eq(hrmsLeaveApps.tenantId, tenantId),
        or(eq(hrmsLeaveApps.status, "pending"), eq(hrmsLeaveApps.status, "draft")),
      ))
      .orderBy(hrmsLeaveApps.createdAt)
      .limit(10)
  );

  return rows.map(mapLeaveInboxRow);
}

/**
 * Leave applications stuck in "routing_failed" (see leave/consumer.ts's
 * WORKFLOW_INSTANCE_REJECTED subscriber) -- an HR-facing signal, surfaced
 * alongside the pending-leave inbox on the dashboard, for requests that
 * will never appear via the normal approvals queue because no
 * workflow.tasks row was ever created for them. Same shape/joins as
 * getPendingLeaveInbox above, just a different status filter -- kept as a
 * separate query rather than a shared query-builder helper, since Drizzle's
 * chained builder type does not abstract cleanly across a function
 * boundary without fighting its generics.
 */
export async function getRoutingFailedLeaveInbox(tenantId: string): Promise<LeaveInboxRow[]> {
  const rows = await db.transaction(async (tx) =>
    tx
      .select({
        id: hrmsLeaveApps.id,
        employeeName: hrmsEmployees.fullName,
        employeeNo: hrmsEmployees.employeeNo,
        departmentName: hrmsDepartments.name,
        leaveTypeName: hrmsLeaveTypes.name,
        leaveTypeCode: hrmsLeaveTypes.code,
        fromDate: hrmsLeaveApps.fromDate,
        toDate: hrmsLeaveApps.toDate,
        daysApplied: hrmsLeaveApps.daysApplied,
        status: hrmsLeaveApps.status,
      })
      .from(hrmsLeaveApps)
      .innerJoin(hrmsEmployees, eq(hrmsLeaveApps.employeeId, hrmsEmployees.id))
      .innerJoin(hrmsDepartments, eq(hrmsEmployees.departmentId, hrmsDepartments.id))
      .innerJoin(hrmsLeaveTypes, eq(hrmsLeaveApps.leaveTypeId, hrmsLeaveTypes.id))
      .where(and(
        eq(hrmsLeaveApps.tenantId, tenantId),
        eq(hrmsLeaveApps.status, "routing_failed"),
      ))
      .orderBy(hrmsLeaveApps.createdAt)
      .limit(10)
  );

  return rows.map(mapLeaveInboxRow);
}
