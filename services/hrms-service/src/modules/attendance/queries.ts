import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { sql } from "drizzle-orm";
import * as repo from "./repo.js";
import * as employeeRepo from "../employee/repo.js";
import type { AttendanceRow } from "./schema.js";

function mapStatus(status: string): "present" | "absent" | "half_day" | "on_leave" | "holiday" {
  if (status === "absent") return "absent";
  if (status === "half_day") return "half_day";
  if (status === "on_leave") return "on_leave";
  if (status === "holiday") return "holiday";
  return "present";
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
    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: empMap.get(r.employeeId)?.fullName ?? r.employeeId.slice(0, 8),
      department: empMap.get(r.employeeId)?.departmentId.slice(0, 8) ?? "",
      date: r.attendanceDate,
      checkIn: r.inTime ?? undefined,
      checkOut: r.outTime ?? undefined,
      status: mapStatus(r.status),
      hoursWorked: undefined,
    }));
  });
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
  const rows = (await db.execute(sql`
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
  `)) as unknown as Array<{
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
