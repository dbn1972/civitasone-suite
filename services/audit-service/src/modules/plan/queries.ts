import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { PlanRow } from "./schema.js";

export async function getPlan(id: string, tenantId: string): Promise<PlanRow | null> {
  return cache.getOrLoad<PlanRow>(
    cache.makeKey(tenantId, "plan", id),
    () => repo.findPlanById(id, tenantId),
  );
}

export async function listPlans(tenantId: string, limit: number): Promise<PlanRow[]> {
  const rows = await cache.getOrLoad<PlanRow[]>(
    cache.makeKey(tenantId, "plan", `list:${limit}`),
    () => repo.listPlansByTenant(tenantId, limit),
  );
  return rows ?? [];
}

export async function listPlanItems(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "audit_plan", `list:${limit}`),
    () => repo.listPlanItemsByTenant(tenantId, limit),
  );
  return (rows ?? []).map((row) => ({
    id: row.id,
    auditUnit: row.unitRef ?? row.deptRef,
    department: row.deptRef,
    type: "routine" as const,
    plannedFrom: row.scheduledFrom.toString(),
    plannedTo: row.scheduledTo.toString(),
    status: (row.status === "completed" ? "completed" : row.status === "in_progress" ? "in_progress" : row.status === "deferred" ? "deferred" : "planned") as "planned" | "in_progress" | "completed" | "deferred",
  }));
}
