import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import { notificationDeliveries } from "./schema.js";
import * as repo from "./repo.js";

export async function listDeliveries(tenantId: string, limit = 50, offset = 0, actorId?: string): Promise<typeof notificationDeliveries.$inferSelect[]> {
  const conditions = actorId
    ? and(eq(notificationDeliveries.tenantId, tenantId), eq(notificationDeliveries.createdBy, actorId))
    : eq(notificationDeliveries.tenantId, tenantId);
  return db.select().from(notificationDeliveries)
    .where(conditions)
    .limit(limit).offset(offset);
}

export async function getDelivery(tenantId: string, id: string): Promise<typeof notificationDeliveries.$inferSelect | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, RESOURCE.delivery, id),
    () => repo.findById(id),
  );
}
