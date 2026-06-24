import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import { notificationDeliveries } from "./schema.js";
import * as repo from "./repo.js";

export async function listDeliveries(tenantId: string, limit = 50, offset = 0, actorId?: string): Promise<typeof notificationDeliveries.$inferSelect[]> {
  const cacheKey = cache.makeKey(tenantId, RESOURCE.delivery, `list:${offset}:${limit}${actorId ? `:${actorId}` : ""}`);
  return (await cache.getOrLoad(cacheKey, () => repo.findByTenant(tenantId, limit, offset, actorId))) ?? [];
}

export async function getDelivery(tenantId: string, id: string): Promise<typeof notificationDeliveries.$inferSelect | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, RESOURCE.delivery, id),
    () => repo.findById(tenantId, id),
  );
}
