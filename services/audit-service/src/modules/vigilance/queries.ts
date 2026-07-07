import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

export async function listVigilanceCases(tenantId: string, limit = 50, offset = 0) {
  const cacheKey = cache.makeKey(tenantId, "vigilance", `list:${limit}:${offset}`);
  return cache.getOrLoad(cacheKey, async () => {
    const items = await repo.listVigilanceCases(tenantId, limit, offset);
    const total = await repo.listVigilanceCasesCount(tenantId);
    return { items, total, limit, offset };
  });
}
