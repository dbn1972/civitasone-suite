import { eq, and, lte, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { scheduledNotifications } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/** Find schedules that are due for dispatch (status='scheduled' AND scheduled_at <= now). */
export async function findDueSchedules(
  now: Date = new Date(), limit = 100,
): Promise<typeof scheduledNotifications.$inferSelect[]> {
  return scopedRead((tx) =>
    tx.select().from(scheduledNotifications)
      .where(and(
        eq(scheduledNotifications.status, "scheduled"),
        lte(scheduledNotifications.scheduledAt, now),
      ))
      .limit(limit),
  );
}

/**
 * Atomically claim a scheduled notification for processing using optimistic locking.
 * Transitions status 'scheduled' → 'queued' only if version matches.
 * Returns true if this caller successfully claimed the schedule.
 */
export async function claimSchedule(
  tx: Writer, id: string, version: number,
): Promise<boolean> {
  const updated = await tx.update(scheduledNotifications).set({
    status: "queued", updatedAt: new Date(), version: version + 1,
  }).where(and(
    eq(scheduledNotifications.id, id),
    eq(scheduledNotifications.version, version),
    eq(scheduledNotifications.status, "scheduled"),
  )).returning({ id: scheduledNotifications.id });
  return updated.length > 0;
}

/** Paginated list of scheduled notifications for a tenant. */
export async function listScheduled(
  tenantId: string, pagination: { limit: number; offset: number } = { limit: 50, offset: 0 },
): Promise<typeof scheduledNotifications.$inferSelect[]> {
  return scopedRead((tx) =>
    tx.select().from(scheduledNotifications)
      .where(eq(scheduledNotifications.tenantId, tenantId))
      .orderBy(desc(scheduledNotifications.scheduledAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
  );
}
