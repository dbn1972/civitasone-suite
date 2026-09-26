import type { APPRAISAL_STATUS_VALUES } from "@civitasone/schemas/web";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as employeeRepo from "../employee/repo.js";

/**
 * `allowedEmployeeIds` is the read-scope resolved by routes.ts's
 * resolveAppraisalReadScope: null (HR -- unrestricted), or the set of
 * hrms_employees.id values the caller may see (their own id and/or direct
 * reports' ids). MUST be part of the cache key below -- this result is
 * cached, and prior to this fix the key only varied by tenantId+limit, so a
 * scoped (manager/employee) result and the unrestricted HR result would
 * collide on the SAME cache entry. That collision would have silently
 * reintroduced the read-scope leak this fix closes (or wrongly narrowed HR's
 * view) for up to CACHE_TTL seconds after whichever caller happened to prime
 * the cache first -- apar/repo.ts's listAppraisals has no cache layer at all
 * so this trap didn't exist there; it's specific to this module.
 */
export async function listAppraisals(tenantId: string, limit: number, allowedEmployeeIds: string[] | null) {
  if (allowedEmployeeIds !== null && allowedEmployeeIds.length === 0) return [];
  const scopeKey = allowedEmployeeIds === null ? "all" : [...allowedEmployeeIds].sort().join(",");
  const key = cache.listKey(tenantId, "appraisals", `list:${limit}:${scopeKey}`);
  return (await cache.getOrLoad(key, async () => {
    const rows = await repo.listByTenant(tenantId, limit, allowedEmployeeIds);
    const employees = await employeeRepo.listByTenant(tenantId, 500, 0);
    const empMap = new Map(employees.map((e) => [e.id, e]));
    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: empMap.get(r.employeeId)?.fullName ?? r.employeeId.slice(0, 8),
      department: empMap.get(r.employeeId)?.departmentId.slice(0, 8) ?? "",
      appraisalPeriod: r.appraisalPeriod,
      rating: r.rating !== null ? Number(r.rating) : undefined,
      // r.status is validated at the HTTP boundary by AppraisalSummaryListSchema
      // (sendValidated in routes.ts) -- this cast just documents the real,
      // full status vocabulary instead of the stale 3-value union it used to
      // claim (see APPRAISAL_STATUS_VALUES's own comment in web.ts for why
      // that mismatch was a live bug, not a cosmetic one).
      status: r.status as (typeof APPRAISAL_STATUS_VALUES)[number],
      reviewerName: r.reviewerId ? r.reviewerId.slice(0, 8) : undefined,
    }));
  })) ?? [];
}
