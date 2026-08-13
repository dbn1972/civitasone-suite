import { eq, and, lte, desc, ne } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead, readScoped } from "../../shared/db.js";
import { scannerDb } from "../../shared/scanner-db.js";
import { notificationDeliveries, type DeliveryInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * P1-3: recipient-scoped inbox. Returns only deliveries addressed TO this user
 * (recipient_id), within the tenant — NOT everything the tenant ever sent.
 */
export async function findByRecipient(
  tenantId: string, recipientId: string, limit = 50, offset = 0,
): Promise<typeof notificationDeliveries.$inferSelect[]> {
  return readScoped(tenantId, (tx) => tx.select().from(notificationDeliveries)
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
  // Cross-tenant discovery via the BYPASSRLS scanner pool: under notification_svc
  // (NOBYPASSRLS, #146) a scopedRead with no tenant context returns ZERO rows and
  // the durable retry sweep silently no-ops. Read-only; the claim below re-runs
  // under the row's tenant so RLS re-checks the write.
  return scannerDb.select().from(notificationDeliveries)
    .where(and(
      eq(notificationDeliveries.status, "queued"),
      lte(notificationDeliveries.nextRetryAt, now),
    ))
    .limit(limit);
}

export async function findByUser(tenantId: string, userId: string, limit = 50): Promise<typeof notificationDeliveries.$inferSelect[]> {
  return readScoped(tenantId, (tx) => tx.select().from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.tenantId, tenantId), eq(notificationDeliveries.createdBy, userId)))
    .limit(limit));
}

export async function findByTenant(tenantId: string, limit = 50, offset = 0, actorId?: string): Promise<typeof notificationDeliveries.$inferSelect[]> {
  const conditions = actorId
    ? and(eq(notificationDeliveries.tenantId, tenantId), eq(notificationDeliveries.createdBy, actorId))
    : eq(notificationDeliveries.tenantId, tenantId);
  return readScoped(tenantId, (tx) => tx.select().from(notificationDeliveries)
    .where(conditions)
    .limit(limit).offset(offset));
}

export async function findById(tenantId: string, id: string): Promise<typeof notificationDeliveries.$inferSelect | null> {
  // SEC P0-1: scope the read to the tenant so a delivery id from another tenant 404s
  // instead of leaking another tenant's notification (callers always know the tenant).
  const rows = await readScoped(tenantId, (tx) => tx.select().from(notificationDeliveries)
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
  id: string, tenantId: string, version: number, now = new Date(),
): Promise<boolean> {
  // Transition to `sending` (an allowed status) so the row leaves the `queued`
  // due-set and won't be picked up by a concurrent sweep. The UPDATE runs inside
  // the row's tenant context (runWithTenant + tx sets the app.tenant_id GUC) so
  // RLS admits it under the NOBYPASSRLS notification_svc role (#146).
  const updated = await (runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx.update(notificationDeliveries).set({
        status: "sending", updatedAt: new Date(), version: version + 1,
      }).where(and(
        eq(notificationDeliveries.id, id),
        eq(notificationDeliveries.tenantId, tenantId),
        eq(notificationDeliveries.version, version),
        eq(notificationDeliveries.status, "queued"),
        lte(notificationDeliveries.nextRetryAt, now),
      )).returning({ id: notificationDeliveries.id }),
    ),
  ) as Promise<{ id: string }[]>);
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

/**
 * Park a delivery that the consent gate deferred for a DND window.
 *
 * Status goes back to `queued` (it is not refused, only postponed) and
 * `next_retry_at` is explicitly CLEARED: leaving a stale retry timestamp on a
 * `queued` row would make the durable retry sweeper republish the send in
 * parallel with the DND release sweeper, sending it twice.
 */
export async function deferDeliveryForDnd(
  tx: Writer, id: string, actorId: string, holdUntil: Date,
): Promise<void> {
  const rows = await tx.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, id)).limit(1);
  const current = rows[0];
  if (!current) return;
  await tx.update(notificationDeliveries).set({
    status: "queued", nextRetryAt: null,
    errorDetail: `held for DND until ${holdUntil.toISOString()}`,
    updatedBy: actorId, updatedAt: new Date(), version: current.version + 1,
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

/** Mark a single delivery as read; scoped to recipient. Returns true if updated. */
export async function markOneRead(
  tenantId: string, recipientId: string, actorId: string, id: string,
): Promise<boolean> {
  const updated = await (runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx.update(notificationDeliveries)
        .set({ status: "read", updatedBy: actorId, updatedAt: new Date() })
        .where(and(
          eq(notificationDeliveries.id, id),
          eq(notificationDeliveries.tenantId, tenantId),
          eq(notificationDeliveries.recipientId, recipientId),
          ne(notificationDeliveries.status, "read"),
        ))
        .returning({ id: notificationDeliveries.id }),
    ),
  ) as Promise<{ id: string }[]>);
  return updated.length > 0;
}

/** Mark ALL unread deliveries for a recipient as read. Returns count updated. */
export async function markAllRead(
  tenantId: string, recipientId: string, actorId: string,
): Promise<number> {
  const updated = await (runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx.update(notificationDeliveries)
        .set({ status: "read", updatedBy: actorId, updatedAt: new Date() })
        .where(and(
          eq(notificationDeliveries.tenantId, tenantId),
          eq(notificationDeliveries.recipientId, recipientId),
          ne(notificationDeliveries.status, "read"),
        ))
        .returning({ id: notificationDeliveries.id }),
    ),
  ) as Promise<{ id: string }[]>);
  return updated.length;
}
