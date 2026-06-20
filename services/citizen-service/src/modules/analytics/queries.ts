import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { aggregateSlaMetrics } from "./domain.js";

export async function getSlaDashboard(tenantId: string) {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "analytics", "sla"),
    async () => {
      const metrics = await repo.listDeliveryMetrics(tenantId);
      return aggregateSlaMetrics(metrics);
    },
  );
}

export async function getGrievanceAnalytics(tenantId: string) {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "analytics", "grievances"),
    () => repo.aggregateGrievancesByDepartment(tenantId),
  );
}
