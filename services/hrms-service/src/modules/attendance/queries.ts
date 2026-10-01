import { cache } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { sql } from "drizzle-orm";
import * as repo from "./repo.js";
import * as employeeRepo from "../employee/repo.js";
import { batchEmployees, batchDepartments } from "../../shared/batch-resolve.js";
import type { AttendanceRow } from "./schema.js";

function mapStatus(status: string): "present" | "absent" | "half_day" | "on_leave" | "holiday" {
  if (status === "absent") return "absent";
  if (status === "half_day") return "half_day";
  if (status === "on_leave") return "on_leave";
  if (status === "holiday") return "holiday";
  return "present";
}

/**
 * GAP-HR-ATTENDANCE-01: hoursWorked used to be hard-coded `undefined` even
 * though inTime/outTime (HH:MM:SS `time` columns, per schema.ts) are already
 * loaded on every row. Same decimal-hours-from-HH:MM:SS derivation
 * repo.ts's listCheckinLog already uses for its own (string-formatted)
 * totalHours column, rounded to 2dp per the catalog's acceptance criteria --
 * but returns a plain number, and deliberately does NOT wrap a
 * negative/zero diff as a cross-midnight shift the way that column's own
 * "h/m" display convention does: this field's contract (per the catalog's
 * own acceptance list) is undefined for missing-or-bad data, not a modeled
 * overnight shift.
 */
function computeHoursWorked(inTime: string | null, outTime: string | null): number | undefined {
  if (!inTime || !outTime) return undefined;
  const [inH, inM] = inTime.split(":").map(Number) as [number, number];
  const [outH, outM] = outTime.split(":").map(Number) as [number, number];
  const minutes = (outH * 60 + outM) - (inH * 60 + inM);
  if (minutes <= 0) return undefined;
  return Math.round((minutes / 60) * 100) / 100;
}

export async function getAttendanceByEmpAndMonth(tenantId: string, employeeId: string, month: string): Promise<AttendanceRow[]> {
  return cache.getOrLoad<AttendanceRow[]>(
    cache.makeKey(tenantId, "attendance_emp_month", `${employeeId}:${month}`),
    () => repo.findByEmpAndMonth(tenantId, employeeId, month)
  ) as Promise<AttendanceRow[]>;
}

export async function listRegularisations(tenantId: string, limit: number) {
  const key = cache.listKey(tenantId, "attendance_reg", `list:${limit}`);
  return (await cache.getOrLoad(key, async () => {
    const rows = await repo.listRegularisationsByTenant(tenantId, limit);
    const employees = await employeeRepo.listByTenant(tenantId, 500, 0);
    const empMap = new Map(employees.map((e) => [e.id, e]));
    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: empMap.get(r.employeeId)?.fullName ?? r.employeeId.slice(0, 8),
      date: r.date,
      reason: r.reason,
      requestedStatus: r.requestedStatus,
      status: r.status as "pending" | "approved" | "rejected",
      requestedAt: new Date(r.requestedAt as unknown as string).toISOString(),
    }));
  })) ?? [];
}

export async function listAttendance(tenantId: string, limit: number) {
  return cache.listOrLoad(tenantId, "attendance", `list:${limit}`, async () => {
    const rows = await repo.listByTenant(tenantId, limit);
    const employees = await employeeRepo.listByTenant(tenantId, 500, 0);
    const empMap = new Map(employees.map((e) => [e.id, e]));
    // GAP-HR-ATTENDANCE-01: department used to be the first 8 chars of the
    // raw departmentId uuid (a permanent-looking id fragment, never a real
    // department name). employee/repo.ts already exposes a cross-module-safe
    // name lookup (findDepartmentsByIds) for exactly this -- one batched
    // query, not N+1, and via the employee module's own repo rather than
    // importing hrms_departments directly (CLAUDE.md rule 4: module
    // isolation).
    const departmentIds = [...new Set(employees.map((e) => e.departmentId))];
    const departments = await employeeRepo.findDepartmentsByIds(tenantId, departmentIds);
    const deptNameById = new Map(departments.map((d) => [d.id, d.name]));
    return rows.map((r) => {
      const emp = empMap.get(r.employeeId);
      return {
        id: r.id,
        employeeId: r.employeeId,
        employeeName: emp?.fullName ?? r.employeeId.slice(0, 8),
        department: (emp && deptNameById.get(emp.departmentId)) ?? "",
        date: r.attendanceDate,
        checkIn: r.inTime ?? undefined,
        checkOut: r.outTime ?? undefined,
        status: mapStatus(r.status),
        hoursWorked: computeHoursWorked(r.inTime, r.outTime),
      };
    });
  });
}

/**
 * GAP-HR-CHECKIN-LOG-02 (display half — the scoping/IDOR half was already
 * closed in routes.ts by resolveSelfScopedEmployeeId, GAP-HR-SF-16 fold-in).
 * repo.listCheckinLog used to return a raw 8-char employeeId slice as
 * "employee" and a permanently blank "department", with no join at all
 * (unlike listAttendance just above). Resolves both via the shared
 * batchEmployees/batchDepartments helpers — the established pattern for new
 * call sites in this module (see GET /overtime-requests in routes.ts) —
 * rather than employeeRepo.listByTenant's 500-row cap listAttendance still
 * uses, so this does not silently miss employees beyond that cap.
 */
export async function listCheckinLog(tenantId: string, limit: number, employeeIds: string[] | undefined, offset = 0) {
  const rows = await repo.listCheckinLog(tenantId, limit, employeeIds, offset);
  const empMap = await batchEmployees(tenantId, rows.map((r) => r.employeeId));
  const deptMap = await batchDepartments(tenantId, [...empMap.values()].map((e) => e.departmentId));
  return rows.map((r) => {
    const emp = empMap.get(r.employeeId);
    return {
      id: r.id,
      employeeId: r.employeeId,
      employee: emp?.fullName ?? r.employeeId.slice(0, 8),
      department: (emp && deptMap.get(emp.departmentId)) ?? "",
      date: r.date,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      source: r.source,
      totalHours: r.totalHours,
    };
  });
}

export async function listAttendanceLocks(tenantId: string, limit = 200) {
  const key = cache.listKey(tenantId, "attendance_locks", "list");
  return (await cache.getOrLoad(key, async () => {
    const rows = await repo.listLocksByTenant(tenantId, limit);
    return rows.map((r) => ({
      id: r.id,
      period: (r.period ?? "").trim(),
      status: r.status as "locked" | "open",
      reason: r.reason ?? undefined,
      lockedBy: r.lockedBy ?? undefined,
      lockedAt: r.lockedAt ? new Date(r.lockedAt as unknown as string).toISOString() : undefined,
    }));
  })) ?? [];
}

export async function getAttendanceSummaryForMonth(
  tenantId: string,
  month: string,
): Promise<Array<{ date: string; presentCount: number; absentCount: number; lateCount: number }>> {
  // month format: YYYY-MM
  const startDate = `${month}-01`;
  // Compute the actual last day of the month to avoid invalid date errors (e.g. June has 30 days, not 31)
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const lastDay = new Date(year, mon, 0).getDate(); // day 0 of next month = last day of this month
  const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;
  // FORCE-RLS fix: this used to run as a bare db.execute() outside any
  // db.transaction()/scopedRead(), so under the NOBYPASSRLS hrms_svc role no
  // app.tenant_id GUC was ever set and the fail-closed policy on
  // attendance.hrms_attendance (FORCE ROW LEVEL SECURITY — migration 0026/0034)
  // silently returned zero rows even for a tenant with genuine attendance
  // records for the month — an empty summary is indistinguishable from "no
  // one has attendance recorded yet", so the caller (routes.ts's GET
  // /v1/hrms/attendance/summary) never saw an error. scopedRead sets the GUC
  // from the request's tenant context before the read runs.
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT
      attendance_date::text AS date,
      COUNT(*) FILTER (WHERE status IN ('present', 'half_day')) AS present_count,
      COUNT(*) FILTER (WHERE status = 'absent')                  AS absent_count,
      COUNT(*) FILTER (WHERE late_mins > 0)                      AS late_count
    FROM attendance.hrms_attendance
    WHERE tenant_id = ${tenantId}::uuid
      AND attendance_date >= ${startDate}::date
      AND attendance_date <= ${endDate}::date
    GROUP BY attendance_date
    ORDER BY attendance_date
  `))) as unknown as Array<{
    date: string;
    present_count: string | number;
    absent_count: string | number;
    late_count: string | number;
  }>;
  return rows.map((r) => ({
    date: r.date,
    presentCount: Number(r.present_count),
    absentCount: Number(r.absent_count),
    lateCount: Number(r.late_count),
  }));
}
