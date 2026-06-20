import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import { notificationDeliveries } from "./schema.js";
import * as repo from "./repo.js";

export async function listDeliveries(tenantId: string, limit = 50, offset = 0): Promise<typeof notificationDeliveries.$inferSelect[]> {
  return db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.tenantId, tenantId))
    .limit(limit).offset(offset);
}

export async function getDelivery(tenantId: string, id: string): Promise<typeof notificationDeliveries.$inferSelect | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, RESOURCE.delivery, id),
    () => repo.findById(id),
  );
}
