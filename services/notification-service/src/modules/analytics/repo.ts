import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { openEvents, clickEvents, deliveryMetrics } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * Record an open event. INSERT ON CONFLICT DO NOTHING ensures deduplication
 * (one open per delivery_id via the unique index).
 */
export async function recordOpen(
  tx: Writer, tenantId: string, deliveryId: string,
): Promise<void> {
  await tx.insert(openEvents).values({
    tenantId,
    deliveryId,
    openedAt: new Date(),
  }).onConflictDoNothing();
}

/** Record a click event (multiple clicks per delivery are allowed). */
export async function recordClick(
  tx: Writer, tenantId: string, deliveryId: string, linkUrl: string,
): Promise<void> {
  await tx.insert(clickEvents).values({
    tenantId,
    deliveryId,
    linkUrl,
    clickedAt: new Date(),
  });
}

export interface MetricsFilters {
  templateId?: string | undefined;
  campaignId?: string | undefined;
  periodStart?: Date | undefined;
  periodEnd?: Date | undefined;
}

/** Get aggregate delivery metrics for a tenant, optionally filtered. */
export async function getAggregateMetrics(
  tenantId: string, filters: MetricsFilters = {},
): Promise<typeof deliveryMetrics.$inferSelect[]> {
  return scopedRead((tx) => {
    const conditions = [eq(deliveryMetrics.tenantId, tenantId)];

    if (filters.templateId) {
      conditions.push(eq(deliveryMetrics.templateId, filters.templateId));
    }
    if (filters.campaignId) {
      conditions.push(eq(deliveryMetrics.campaignId, filters.campaignId));
    }
    if (filters.periodStart) {
      conditions.push(gte(deliveryMetrics.periodStart, filters.periodStart));
    }
    if (filters.periodEnd) {
      conditions.push(lte(deliveryMetrics.periodEnd, filters.periodEnd));
    }

    return tx.select().from(deliveryMetrics)
      .where(and(...conditions));
  });
}
