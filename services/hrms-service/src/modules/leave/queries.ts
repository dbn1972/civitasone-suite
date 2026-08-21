import { cache } from "../../shared/infra.js";
import { eq } from "drizzle-orm";
import * as repo from "./repo.js";
import * as employeeRepo from "../employee/repo.js";
import { hrmsLeaveAllocs, type LeaveAppRow } from "./schema.js";

function mapLeaveStatus(status: string): "pending" | "approved" | "rejected" | "cancelled" {
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  if (status === "cancelled") return "cancelled";
  return "pending";
}

export async function getLeaveApp(id: string, tenantId: string): Promise<LeaveAppRow | null> {
  return cache.getOrLoad<LeaveAppRow>(
    cache.makeKey(tenantId, "leave_app", id),
    () => repo.findLeaveAppById(id, tenantId)
  );
}

export async function getLeaveApplicationsByEmp(
  tenantId: string,
  employeeId: string,
): Promise<(LeaveAppRow & { leaveTypeName: string })[]> {
  const [rows, leaveTypes] = await Promise.all([
    cache.getOrLoad<LeaveAppRow[]>(
      cache.makeKey(tenantId, "leave_apps_emp", employeeId),
      () => repo.findLeaveAppsByEmp(tenantId, employeeId),
    ) as Promise<LeaveAppRow[]>,
    repo.listLeaveTypesByTenant(tenantId),
  ]);
  const typeNameById = new Map(leaveTypes.map((t) => [t.id, t.name]));
  return rows.map((r) => ({
    ...r,
    leaveTypeName: typeNameById.get(r.leaveTypeId) ?? r.leaveTypeId.slice(0, 8),
  }));
}

/**
 * Same display shape as `listLeaveApplications` (id/employee/leaveType/status),
 * scoped to a single employee — used by the *validated* `GET /v1/hrms/leave-applications?empId=`
 * route, which parses the result against `leaveRequestSchema`.
 *
 * Deliberately does NOT reuse `getLeaveApplicationsByEmp`'s raw-row output as its
 * own return shape: that function's raw `LeaveAppRow & {leaveTypeName}` shape is
 * a separate, real contract already relied on by the *unvalidated*
 * `GET /v1/hrms/leave/applications` route (and the leave-history web page, which
 * reads `fromDate`/`toDate`/`daysApplied`/`reason`/lowercase `status` directly off
 * it) — reshaping that function in place would silently break that consumer.
 * Instead this wraps it and maps to the lightweight DTO on top, the same way
 * `listLeaveApplications` maps `repo.findLeaveAppsByTenant` rows.
 */
export async function listLeaveApplicationsByEmp(
  tenantId: string,
  employeeId: string,
): Promise<{ data: Array<{ id: string; employee: string; leaveType: string; status: "Pending" | "Approved" | "Rejected" }> }> {
  const [rows, employee] = await Promise.all([
    getLeaveApplicationsByEmp(tenantId, employeeId),
    employeeRepo.findById(employeeId, tenantId),
  ]);
  const employeeName = employee?.fullName ?? employeeId.slice(0, 8);
  return {
    data: rows.map((r) => ({
      id: r.id,
      employee: employeeName,
      leaveType: r.leaveTypeName,
      status: r.status === "approved" ? "Approved" as const : r.status === "rejected" ? "Rejected" as const : "Pending" as const,
    })),
  };
}

export async function listLeaveApplications(tenantId: string, limit: number, offset = 0): Promise<{ data: Array<{ id: string; employee: string; leaveType: string; status: "Pending" | "Approved" | "Rejected" }> }> {
  const [rows, employees, leaveTypes] = await Promise.all([
    repo.findLeaveAppsByTenant(tenantId, limit, offset),
    employeeRepo.listByTenant(tenantId, 500, 0),
    repo.listLeaveTypesByTenant(tenantId),
  ]);
  const empNameById = new Map(employees.map((e) => [e.id, e.fullName]));
  const typeNameById = new Map(leaveTypes.map((t) => [t.id, t.name]));
  return {
    data: rows.map((r) => ({
      id: r.id,
      employee: empNameById.get(r.employeeId) ?? r.employeeId.slice(0, 8),
      leaveType: typeNameById.get(r.leaveTypeId) ?? r.leaveTypeId.slice(0, 8),
      status: r.status === "approved" ? "Approved" as const : r.status === "rejected" ? "Rejected" as const : "Pending" as const,
    })),
  };
}

export async function listLeaveRequestDetails(tenantId: string, limit: number, offset = 0) {
  return cache.listOrLoad(tenantId, "leave_request_detail", `list:${limit}:${offset}`, async () => {
    const rows = await repo.findLeaveAppsByTenant(tenantId, limit, offset);
    const [employees, leaveTypes] = await Promise.all([
      employeeRepo.listByTenant(tenantId, 500, 0),
      repo.listLeaveTypesByTenant(tenantId),
    ]);
    const empMap = new Map(employees.map((e) => [e.id, e]));
    const typeNameById = new Map(leaveTypes.map((t) => [t.id, t.name]));
    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: empMap.get(r.employeeId)?.fullName ?? r.employeeId.slice(0, 8),
      leaveType: typeNameById.get(r.leaveTypeId) ?? r.leaveTypeId.slice(0, 8),
      fromDate: r.fromDate,
      toDate: r.toDate,
      days: r.daysApplied,
      reason: r.reason ?? undefined,
      approver: r.approvedBy ?? undefined,
      status: mapLeaveStatus(r.status),
      appliedAt: new Date(r.createdAt as unknown as string).toISOString(),
    }));
  });
}


export async function listLeaveAllocations(tenantId: string, limit: number) {
  const { scopedRead } = await import("../../shared/db.js");
  const rows = await scopedRead((tx) => tx.select().from(hrmsLeaveAllocs).where(eq(hrmsLeaveAllocs.tenantId, tenantId)).limit(limit));
  return rows.map(r => ({ id: r.id, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, fy: r.fy, totalDays: r.totalDays, balanceDays: r.balanceDays }));
}
