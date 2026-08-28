import { eq, and, lte } from "drizzle-orm";
import { scannerDb } from "../../shared/scanner-db.js";
import { db, scopedRead } from "../../shared/db.js";
import { dndWindows, heldNotifications, type HeldNotificationInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * Enabled DND windows for a user, read inside the caller's transaction.
 *
 * The send gate must run in the same transaction as the delivery write, so it
 * cannot use `findActiveWindows` (which opens its own tenant transaction) — a
 * separate connection would let a window change mid-send.
 */
export async function findActiveWindowsTx(
  tx: Writer, tenantId: string, userId: string,
): Promise<typeof dndWindows.$inferSelect[]> {
  return tx.select().from(dndWindows)
    .where(and(
      eq(dndWindows.tenantId, tenantId),
      eq(dndWindows.userId, userId),
      eq(dndWindows.enabled, true),
    ));
}

/**
 * Park a notification until its DND window ends. `sweepHeldNotifications`
 * re-publishes `deliveryPayload` verbatim once `holdUntil` passes, so the
 * payload must carry the original `deliveryId` for the release to update the
 * same delivery row instead of creating a second one.
 */
export async function insertHeldNotification(
  tx: Writer, row: HeldNotificationInsert,
): Promise<void> {
  await tx.insert(heldNotifications).values(row);
}

/** Find all active (enabled) DND windows for a user within a tenant. */
export async function findActiveWindows(
  tenantId: string, userId: string,
): Promise<typeof dndWindows.$inferSelect[]> {
  return scopedRead((tx) =>
    tx.select().from(dndWindows)
      .where(and(
        eq(dndWindows.tenantId, tenantId),
        eq(dndWindows.userId, userId),
        eq(dndWindows.enabled, true),
      )),
  );
}

/** Find held notifications that are due for release (hold_until <= now AND status='held'). */
export async function findHeldNotifications(
  now: Date = new Date(), limit = 100,
): Promise<typeof heldNotifications.$inferSelect[]> {
  // Cross-tenant discovery via the BYPASSRLS scanner pool (see scanner-db.ts):
  // a scopedRead with no tenant context returns ZERO rows under NOBYPASSRLS (#146).
  return scannerDb.select().from(heldNotifications)
    .where(and(
      eq(heldNotifications.status, "held"),
      lte(heldNotifications.holdUntil, now),
    ))
    .limit(limit);
}

/**
 * Release a held notification by transitioning status from 'held' to 'released'.
 */
export async function releaseHeld(tx: Writer, id: string): Promise<void> {
  await tx.update(heldNotifications).set({
    status: "released",
    updatedAt: new Date(),
  }).where(and(
    eq(heldNotifications.id, id),
    eq(heldNotifications.status, "held"),
  ));
}

/**
 * Find a single DND window by id (tenant-scoped), for ownership checks
 * before allowing a PATCH/DELETE by a non-admin caller.
 */
export async function findWindowById(
  tenantId: string, id: string,
): Promise<typeof dndWindows.$inferSelect | undefined> {
  const rows = await scopedRead((tx) =>
    tx.select().from(dndWindows)
      .where(and(eq(dndWindows.tenantId, tenantId), eq(dndWindows.id, id)))
      .limit(1),
  );
  return rows[0];
}
