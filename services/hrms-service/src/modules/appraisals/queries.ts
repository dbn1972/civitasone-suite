import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as employeeRepo from "../employee/repo.js";

export async function listAppraisals(tenantId: string, limit: number) {
  const key = cache.listKey(tenantId, "appraisals", `list:${limit}`);
  return (await cache.getOrLoad(key, async () => {
    const rows = await repo.listByTenant(tenantId, limit);
    const employees = await employeeRepo.listByTenant(tenantId, 500, 0);
    const empMap = new Map(employees.map((e) => [e.id, e]));
    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: empMap.get(r.employeeId)?.fullName ?? r.employeeId.slice(0, 8),
      department: empMap.get(r.employeeId)?.departmentId.slice(0, 8) ?? "",
      appraisalPeriod: r.appraisalPeriod,
      rating: r.rating !== null ? Number(r.rating) : undefined,
      status: r.status as "pending" | "in_review" | "completed",
      reviewerName: r.reviewerId ? r.reviewerId.slice(0, 8) : undefined,
    }));
  })) ?? [];
}
