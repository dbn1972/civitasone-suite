import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import { notificationDeliveries } from "./schema.js";
import * as repo from "./repo.js";

export async function listDeliveries(tenantId: string, limit = 50, offset = 0, actorId?: string): Promise<typeof notificationDeliveries.$inferSelect[]> {
  const cacheKey = cache.makeKey(tenantId, RESOURCE.delivery, `list:${offset}:${limit}${actorId ? `:${actorId}` : ""}`);
  return (await cache.getOrLoad(cacheKey, () => repo.findByTenant(tenantId, limit, offset, actorId))) ?? [];
}

/**
 * P1-3: recipient-scoped inbox — only notifications addressed TO this user
 * (recipient_id), within the tenant. Used by GET /notifications/notifications.
 */
export async function listInbox(tenantId: string, recipientId: string, limit = 50, offset = 0): Promise<typeof notificationDeliveries.$inferSelect[]> {
  const cacheKey = cache.makeKey(tenantId, RESOURCE.delivery, `inbox:${recipientId}:${offset}:${limit}`);
  return (await cache.getOrLoad(cacheKey, () => repo.findByRecipient(tenantId, recipientId, limit, offset))) ?? [];
}

export async function getDelivery(tenantId: string, id: string): Promise<typeof notificationDeliveries.$inferSelect | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, RESOURCE.delivery, id),
    () => repo.findById(tenantId, id),
  );
}

/** Mark a single inbox notification as read (recipient-scoped). */
export async function markAsRead(tenantId: string, actorId: string, id: string): Promise<boolean> {
  return repo.markOneRead(tenantId, actorId, actorId, id);
}

/** Mark all inbox notifications as read for the calling user. Returns count. */
export async function markAllAsRead(tenantId: string, actorId: string): Promise<number> {
  return repo.markAllRead(tenantId, actorId, actorId);
}
