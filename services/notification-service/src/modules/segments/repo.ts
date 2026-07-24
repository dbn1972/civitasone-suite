import { eq, and } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { recipientSegments } from "./schema.js";
import { buildSegmentQuery, type SegmentCriteria, type SegmentFilter } from "./domain.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/** Insert a new recipient segment. */
export async function insertSegment(
  tx: Writer,
  data: typeof recipientSegments.$inferInsert,
): Promise<void> {
  await tx.insert(recipientSegments).values(data);
}

/** Update an existing segment by ID within a tenant. */
export async function updateSegmentById(
  tx: Writer,
  id: string,
  tenantId: string,
  data: Partial<Pick<typeof recipientSegments.$inferSelect, "name" | "description" | "criteria" | "cachedCount" | "updatedBy" | "updatedAt" | "version">>,
): Promise<void> {
  await tx.update(recipientSegments).set({
    ...data,
    updatedAt: new Date(),
  }).where(and(
    eq(recipientSegments.id, id),
    eq(recipientSegments.tenantId, tenantId),
  ));
}

/** Find a segment by ID within a tenant. */
export async function findSegmentById(
  tenantId: string, id: string,
): Promise<typeof recipientSegments.$inferSelect | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(recipientSegments)
      .where(and(
        eq(recipientSegments.tenantId, tenantId),
        eq(recipientSegments.id, id),
      ))
      .limit(1),
  );
  return rows[0] ?? null;
}

/** List all segments for a tenant. */
export async function listSegments(
  tenantId: string,
): Promise<typeof recipientSegments.$inferSelect[]> {
  return scopedRead((tx) =>
    tx.select().from(recipientSegments)
      .where(eq(recipientSegments.tenantId, tenantId)),
  );
}

/**
 * Resolve a segment's criteria into a list of filters for recipient lookup.
 * In production, this would call the identity/hrms service to get matching users.
 * Here we return the structured filters that the caller uses to make the cross-service call.
 */
export function resolveSegmentFilters(criteria: SegmentCriteria): SegmentFilter[] {
  return buildSegmentQuery(criteria);
}

/**
 * Preview a segment: returns the filter structure and a simulated count.
 * In production, this calls the identity service to get a live preview.
 */
export async function previewSegment(
  tenantId: string, segmentId: string,
): Promise<{ filters: SegmentFilter[]; count: number | null; sample: string[] }> {
  const segment = await findSegmentById(tenantId, segmentId);
  if (!segment) return { filters: [], count: null, sample: [] };

  const filters = buildSegmentQuery(segment.criteria as SegmentCriteria);
  // Count and sample would come from a cross-service call to identity service.
  // Return cached count if available.
  return { filters, count: segment.cachedCount, sample: [] };
}
