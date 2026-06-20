import { cache } from "../../shared/infra.js";
import { QUERY_RESOURCE } from "../../topics.js";
export async function getQueryRun(id: string, tenantId: string) {
  return cache.getOrLoad(cache.makeKey(tenantId, QUERY_RESOURCE, id), async () => null);
}
