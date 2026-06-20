import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as employeeRepo from "../employee/repo.js";
import type { LeaveAppRow } from "./schema.js";

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

export async function getLeaveApplicationsByEmp(tenantId: string, employeeId: string): Promise<LeaveAppRow[]> {
  return cache.getOrLoad<LeaveAppRow[]>(
    cache.makeKey(tenantId, "leave_apps_emp", employeeId),
    () => repo.findLeaveAppsByEmp(tenantId, employeeId)
  ) as Promise<LeaveAppRow[]>;
}

export async function listLeaveApplications(tenantId: string, limit: number): Promise<{ data: Array<{ id: string; employee: string; leaveType: string; status: "Pending" | "Approved" | "Rejected" }> }> {
  const rows = await repo.findLeaveAppsByTenant(tenantId, limit);
  return {
    data: rows.map((r) => ({
      id: r.id,
      employee: r.employeeId.slice(0, 8),
      leaveType: r.leaveTypeId.slice(0, 8),
      status: r.status === "approved" ? "Approved" as const : r.status === "rejected" ? "Rejected" as const : "Pending" as const,
    })),
  };
}

export async function listLeaveRequestDetails(tenantId: string, limit: number) {
  return cache.listOrLoad(tenantId, "leave_request_detail", `list:${limit}`, async () => {
    const rows = await repo.findLeaveAppsByTenant(tenantId, limit);
    const employees = await employeeRepo.listByTenant(tenantId, 500, 0);
    const empMap = new Map(employees.map((e) => [e.id, e]));
    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: empMap.get(r.employeeId)?.fullName ?? r.employeeId.slice(0, 8),
      leaveType: r.leaveTypeId.slice(0, 8),
      fromDate: r.fromDate,
      toDate: r.toDate,
      days: r.daysApplied,
      reason: r.reason ?? undefined,
      approver: r.approvedBy ?? undefined,
      status: mapLeaveStatus(r.status),
      appliedAt: r.createdAt.toISOString(),
    }));
  });
}
