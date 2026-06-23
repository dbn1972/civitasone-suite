import { cache } from "../../shared/infra.js";
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
