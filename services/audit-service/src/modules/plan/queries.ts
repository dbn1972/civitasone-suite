import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { PlanRow } from "./schema.js";

export async function getPlan(id: string, tenantId: string): Promise<PlanRow | null> {
  return cache.getOrLoad<PlanRow>(
    cache.makeKey(tenantId, "plan", id),
    () => repo.findPlanById(id),
  );
}
