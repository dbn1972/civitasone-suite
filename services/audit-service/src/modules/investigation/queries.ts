import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

export async function listInvestigations(tenantId: string, limit = 50, offset = 0) {
  const cacheKey = cache.makeKey(tenantId, "investigation", `list:${limit}:${offset}`);
  return cache.getOrLoad(cacheKey, async () => {
    const items = await repo.listInvestigations(tenantId, limit, offset);
    const total = await repo.listInvestigationsCount(tenantId);
    return { items, total, limit, offset };
  });
}
