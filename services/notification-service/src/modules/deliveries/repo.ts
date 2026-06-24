import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { notificationDeliveries, type DeliveryInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findByUser(tenantId: string, userId: string, limit = 50): Promise<typeof notificationDeliveries.$inferSelect[]> {
  return db.select().from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.tenantId, tenantId), eq(notificationDeliveries.createdBy, userId)))
    .limit(limit);
}

export async function findByTenant(tenantId: string, limit = 50, offset = 0, actorId?: string): Promise<typeof notificationDeliveries.$inferSelect[]> {
  const conditions = actorId
    ? and(eq(notificationDeliveries.tenantId, tenantId), eq(notificationDeliveries.createdBy, actorId))
    : eq(notificationDeliveries.tenantId, tenantId);
  return db.select().from(notificationDeliveries)
    .where(conditions)
    .limit(limit).offset(offset);
}

export async function findById(tenantId: string, id: string): Promise<typeof notificationDeliveries.$inferSelect | null> {
  // SEC P0-1: scope the read to the tenant so a delivery id from another tenant 404s
  // instead of leaking another tenant's notification (callers always know the tenant).
  const rows = await db.select().from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.tenantId, tenantId), eq(notificationDeliveries.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function insertDelivery(tx: Writer, row: DeliveryInsert): Promise<void> {
  await tx.insert(notificationDeliveries).values(row);
}

export async function updateDeliveryStatus(
  tx: Writer, id: string, status: string, actorId: string, version: number,
  sentAt?: Date, error?: string, errorDetail?: string,
): Promise<void> {
  await tx.update(notificationDeliveries).set({
    status, updatedBy: actorId, version, updatedAt: new Date(),
    ...(sentAt ? { sentAt } : {}),
    ...(error ? { error } : {}),
    ...(errorDetail ? { errorDetail } : {}),
  }).where(eq(notificationDeliveries.id, id));
}

export async function scheduleDeliveryRetry(
  tx: Writer, id: string, retryCount: number, nextRetryAt: Date, actorId: string, errorDetail: string,
): Promise<void> {
  const rows = await tx.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, id)).limit(1);
  const current = rows[0];
  if (!current) return;
  await tx.update(notificationDeliveries).set({
    status: "queued", retryCount, nextRetryAt, errorDetail,
    updatedBy: actorId, updatedAt: new Date(), version: current.version + 1,
  }).where(eq(notificationDeliveries.id, id));
}
