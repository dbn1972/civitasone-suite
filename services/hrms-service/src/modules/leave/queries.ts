import { cache } from "../../shared/infra.js";
import { and, eq, inArray } from "drizzle-orm";
import * as repo from "./repo.js";
import * as employeeRepo from "../employee/repo.js";
import { hrmsLeaveAllocs, type LeaveAppRow } from "./schema.js";

function mapLeaveStatus(status: string): "pending" | "approved" | "rejected" | "cancelled" | "routing_failed" {
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  if (status === "cancelled") return "cancelled";
  if (status === "routing_failed") return "routing_failed";
  return "pending";
}

export async function getLeaveApp(id: string, tenantId: string): Promise<LeaveAppRow | null> {
  return cache.getOrLoad<LeaveAppRow>(
    cache.makeKey(tenantId, "leave_app", id),
    () => repo.findLeaveAppById(id, tenantId)
  );
}

/**
 * GAP-HR-LEAVE-HISTORY-01: now honours limit/offset (previously always
 * called repo.findLeaveAppsByEmp with NO limit/offset args at all, so a
 * caller's own page size/offset were silently dropped) and returns a real
 * `total` + per-status `statusCounts` alongside the page of rows, instead of
 * letting the only caller (routes.ts's `/leave/applications`) fall back to
 * `data.length` as a fake "total".
 *
 * Cache key: switched from a single `getOrLoad` key (one cached blob per
 * employee, shared across every limit/offset — which would have silently
 * served page 1's data for a page-2 request) to `listOrLoad`'s
 * resource+hash scheme, with `${employeeId}:${limit}:${offset}` as the hash
 * so each distinct page gets its own cache entry. Every existing
 * `cache.invalidate(cache.makeKey(tenantId, "leave_apps_emp", employeeId))`
 * call site (consumer.ts x4, eoffice-consumer.ts x1) is updated alongside
 * this to `cache.invalidateResource(tenantId, "leave_apps_emp")` — a plain
 * single-key `invalidate` targeting the OLD key shape would no longer match
 * any of these new list-keyed entries, which would have left every one of
 * them stale for up to the resource's TTL after an apply/approve/reject/
 * cancel. See packages/cache/src/index.ts's own `invalidateResource` doc
 * comment — built for exactly this "one resource name, many cached
 * sub-pages" shape.
 */
export async function getLeaveApplicationsByEmp(
  tenantId: string,
  employeeId: string,
  limit = 50,
  offset = 0,
): Promise<{ data: (LeaveAppRow & { leaveTypeName: string })[]; total: number; statusCounts: Record<string, number> }> {
  const [rows, leaveTypes, total, statusCounts] = await cache.listOrLoad(
    tenantId,
    "leave_apps_emp",
    `${employeeId}:${limit}:${offset}`,
    () => Promise.all([
      repo.findLeaveAppsByEmp(tenantId, employeeId, limit, offset),
      repo.listLeaveTypesByTenant(tenantId),
      repo.countLeaveAppsByEmp(tenantId, employeeId),
      repo.countLeaveAppsByEmpByStatus(tenantId, employeeId),
    ]),
  );
  const typeNameById = new Map(leaveTypes.map((t) => [t.id, t.name]));
  return {
    data: rows.map((r) => ({
      ...r,
      leaveTypeName: typeNameById.get(r.leaveTypeId) ?? r.leaveTypeId.slice(0, 8),
    })),
    total,
    statusCounts,
  };
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
  const [result, employee] = await Promise.all([
    getLeaveApplicationsByEmp(tenantId, employeeId),
    employeeRepo.findById(employeeId, tenantId),
  ]);
  const rows = result.data;
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

/**
 * GAP-HR-LEAVE-03/04: `employeeIds` now flows straight into the SQL query
 * (repo.findLeaveAppsByTenant) instead of being applied by the caller as a
 * post-fetch filter on an already limit/offset-truncated tenant-wide page
 * (which could silently hide a scoped caller's own rows if they fell outside
 * that page). The cache key includes a scope fingerprint so an HR (unscoped)
 * read and a manager/employee (scoped) read of the "same" limit/offset never
 * collide. Employee-name resolution now looks up exactly the employees
 * referenced by the returned rows (`listByIds`) instead of the first 500 in
 * the tenant, so a request from employee #550 of 600 still resolves a real
 * name; a genuinely missing employee falls back to "Unknown employee", not a
 * UUID fragment.
 */
export async function listLeaveRequestDetails(tenantId: string, limit: number, offset = 0, employeeIds?: string[]) {
  if (employeeIds && employeeIds.length === 0) return [];
  const scopeKey = employeeIds ? [...employeeIds].sort().join(",") : "all";
  return cache.listOrLoad(tenantId, "leave_request_detail", `list:${limit}:${offset}:${scopeKey}`, async () => {
    const rows = await repo.findLeaveAppsByTenant(tenantId, limit, offset, employeeIds);
    const distinctEmployeeIds = Array.from(new Set(rows.map((r) => r.employeeId)));
    const [employees, leaveTypes] = await Promise.all([
      employeeRepo.listByIds(tenantId, distinctEmployeeIds),
      repo.listLeaveTypesByTenant(tenantId),
    ]);
    const empMap = new Map(employees.map((e) => [e.id, e]));
    const typeNameById = new Map(leaveTypes.map((t) => [t.id, t.name]));
    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: empMap.get(r.employeeId)?.fullName ?? "Unknown employee",
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


/**
 * IDOR fix: this used to run with `WHERE tenant_id=$1 LIMIT 50` and no
 * employee scoping whatsoever. `employeeIds`, when passed, restricts the
 * result to those employees (self-service/manager callers — see
 * leave/routes.ts's resolveLeaveReadScope); `undefined` means "unscoped"
 * (HR, today's behaviour); an explicitly EMPTY array short-circuits to no
 * rows without a DB round-trip (an unresolvable self-service actor, or a
 * manager with no direct reports — never falls through to unscoped).
 */
export async function listLeaveAllocations(tenantId: string, limit: number, employeeIds?: string[]) {
  if (employeeIds && employeeIds.length === 0) return [];
  const { scopedRead } = await import("../../shared/db.js");
  const conditions = [eq(hrmsLeaveAllocs.tenantId, tenantId)];
  if (employeeIds) conditions.push(inArray(hrmsLeaveAllocs.employeeId, employeeIds));
  const rows = await scopedRead((tx) => tx.select().from(hrmsLeaveAllocs).where(and(...conditions)).limit(limit));
  return rows.map(r => ({ id: r.id, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, fy: r.fy, totalDays: r.totalDays, balanceDays: r.balanceDays }));
}
