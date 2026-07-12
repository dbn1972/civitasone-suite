import { eq, and, lte, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { notificationDeliveries, type DeliveryInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * P1-3: recipient-scoped inbox. Returns only deliveries addressed TO this user
 * (recipient_id), within the tenant — NOT everything the tenant ever sent.
 */
export async function findByRecipient(
  tenantId: string, recipientId: string, limit = 50, offset = 0,
): Promise<typeof notificationDeliveries.$inferSelect[]> {
  return scopedRead((tx) => tx.select().from(notificationDeliveries)
    .where(and(
      eq(notificationDeliveries.tenantId, tenantId),
      eq(notificationDeliveries.recipientId, recipientId),
    ))
    .orderBy(desc(notificationDeliveries.createdAt))
    .limit(limit).offset(offset));
}

/**
 * P1-2: durable retry sweep. Returns deliveries whose retry is due
 * (status='queued' AND next_retry_at <= now). Survives a worker restart because
 * the due set lives in Postgres, not an in-process setTimeout.
 */
export async function findDueRetries(
  now = new Date(), limit = 100,
): Promise<typeof notificationDeliveries.$inferSelect[]> {
  return scopedRead((tx) => tx.select().from(notificationDeliveries)
    .where(and(
      eq(notificationDeliveries.status, "queued"),
      lte(notificationDeliveries.nextRetryAt, now),
    ))
    .limit(limit));
}

export async function findByUser(tenantId: string, userId: string, limit = 50): Promise<typeof notificationDeliveries.$inferSelect[]> {
  return scopedRead((tx) => tx.select().from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.tenantId, tenantId), eq(notificationDeliveries.createdBy, userId)))
    .limit(limit));
}

export async function findByTenant(tenantId: string, limit = 50, offset = 0, actorId?: string): Promise<typeof notificationDeliveries.$inferSelect[]> {
  const conditions = actorId
    ? and(eq(notificationDeliveries.tenantId, tenantId), eq(notificationDeliveries.createdBy, actorId))
    : eq(notificationDeliveries.tenantId, tenantId);
  return scopedRead((tx) => tx.select().from(notificationDeliveries)
    .where(conditions)
    .limit(limit).offset(offset));
}

export async function findById(tenantId: string, id: string): Promise<typeof notificationDeliveries.$inferSelect | null> {
  // SEC P0-1: scope the read to the tenant so a delivery id from another tenant 404s
  // instead of leaking another tenant's notification (callers always know the tenant).
  const rows = await scopedRead((tx) => tx.select().from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.tenantId, tenantId), eq(notificationDeliveries.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function insertDelivery(tx: Writer, row: DeliveryInsert): Promise<void> {
  await tx.insert(notificationDeliveries).values(row);
}

/**
 * P1-2: atomically claim a due retry so concurrent sweeps don't double-publish.
 * Transitions status `queued`→`retrying` ONLY while it is still due and at the
 * expected version. Returns true if this caller won the claim.
 */
export async function claimDueRetry(
  id: string, version: number, now = new Date(),
): Promise<boolean> {
  // Transition to `sending` (an allowed status) so the row leaves the `queued`
  // due-set and won't be picked up by a concurrent sweep.
  const updated = await db.update(notificationDeliveries).set({
    status: "sending", updatedAt: new Date(), version: version + 1,
  }).where(and(
    eq(notificationDeliveries.id, id),
    eq(notificationDeliveries.version, version),
    eq(notificationDeliveries.status, "queued"),
    lte(notificationDeliveries.nextRetryAt, now),
  )).returning({ id: notificationDeliveries.id });
  return updated.length > 0;
}

export async function updateDeliveryStatus(
  tx: Writer, id: string, status: string, actorId: string, version: number,
  sentAt?: Date, error?: string, errorDetail?: string, channel?: string,
): Promise<void> {
  await tx.update(notificationDeliveries).set({
    status, updatedBy: actorId, version, updatedAt: new Date(),
    ...(sentAt ? { sentAt } : {}),
    ...(error ? { error } : {}),
    ...(errorDetail ? { errorDetail } : {}),
    ...(channel ? { channel } : {}),
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
