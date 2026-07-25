import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { PlanRow, PlanLineRow } from "./schema.js";

function serializePlan(plan: PlanRow): Record<string, unknown> {
  return { ...plan, totalEstimatedMinor: String(plan.totalEstimatedMinor) };
}

function serializeLine(line: PlanLineRow): Record<string, unknown> {
  return { ...line, estimatedValueMinor: String(line.estimatedValueMinor) };
}

export async function getPlan(id: string, tenantId: string): Promise<Record<string, unknown> | null> {
  const plan = await cache.getOrLoad<PlanRow | null>(
    cache.makeKey(tenantId, "plan", id),
    () => repo.findPlanById(id, tenantId),
  );
  if (!plan || plan.tenantId !== tenantId) return null;
  const lines = await repo.findPlanLines(id, tenantId);
  return { ...serializePlan(plan), lines: lines.map(serializeLine) };
}

export async function listPlans(tenantId: string, limit = 50, offset = 0): Promise<Record<string, unknown>[]> {
  const rows = await repo.listPlansByTenant(tenantId, limit, offset);
  return rows.map(serializePlan);
}
