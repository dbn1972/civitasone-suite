import { eq, and, lte } from "drizzle-orm";
import { scannerDb } from "../../shared/scanner-db.js";
import { db, scopedRead } from "../../shared/db.js";
import { dndWindows, heldNotifications } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

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
