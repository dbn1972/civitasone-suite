import { eq, and, lte, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { digestRules, digestBuckets } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/** Find digest buckets whose accumulation window has expired and are still accumulating. */
export async function findExpiredBuckets(
  now: Date = new Date(), limit = 100,
): Promise<typeof digestBuckets.$inferSelect[]> {
  return scopedRead((tx) =>
    tx.select().from(digestBuckets)
      .where(and(
        eq(digestBuckets.status, "accumulating"),
        lte(digestBuckets.openedAt, now),
      ))
      .limit(limit),
  );
}

/** Accumulate an item into an existing digest bucket (append to items JSONB array). */
export async function accumulateItem(
  tx: Writer, bucketId: string, item: Record<string, unknown>,
): Promise<void> {
  await tx.update(digestBuckets).set({
    items: sql`${digestBuckets.items} || ${JSON.stringify([item])}::jsonb`,
    itemCount: sql`${digestBuckets.itemCount} + 1`,
    updatedAt: new Date(),
  }).where(eq(digestBuckets.id, bucketId));
}

/** List all digest rules for a tenant. */
export async function listRules(tenantId: string): Promise<typeof digestRules.$inferSelect[]> {
  return scopedRead((tx) =>
    tx.select().from(digestRules)
      .where(eq(digestRules.tenantId, tenantId)),
  );
}

/** Find the active digest rule for a given event type and channel within a tenant. */
export async function findRuleForEvent(
  tenantId: string, eventType: string, channel: string,
): Promise<typeof digestRules.$inferSelect | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(digestRules)
      .where(and(
        eq(digestRules.tenantId, tenantId),
        eq(digestRules.eventType, eventType),
        eq(digestRules.channel, channel),
        eq(digestRules.enabled, true),
      ))
      .limit(1),
  );
  return rows[0] ?? null;
}
