import { eq, and, sql } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { segmentEligibilityRules } from "./schema.js";
import type { SegmentEligibilityRuleRow, SegmentEligibilityRuleView } from "./schema.js";

const RESOURCE = "segment_eligibility_rule";

function toView(row: SegmentEligibilityRuleRow): SegmentEligibilityRuleView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    segmentCode: row.segmentCode,
    productId: row.productId,
    eligible: row.eligible,
    channelOverride: row.channelOverride ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function findById(id: string, tenantId: string): Promise<SegmentEligibilityRuleView | null> {
  const key = cache.makeKey(tenantId, RESOURCE, id);
  return cache.getOrLoad(key, async () => {
    const rows: SegmentEligibilityRuleRow[] = await scopedRead((tx) =>
      tx.select().from(segmentEligibilityRules)
        .where(and(eq(segmentEligibilityRules.id, id), eq(segmentEligibilityRules.tenantId, tenantId)))
        .limit(1) as any,
    ) as any;
    if (rows.length === 0) return null;
    return toView(rows[0]!);
  });
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  segmentCode?: string,
  productId?: string,
): Promise<{ data: SegmentEligibilityRuleView[]; total: number }> {
  return scopedRead(async (tx) => {
    const conditions = [eq(segmentEligibilityRules.tenantId, tenantId)];
    if (segmentCode) conditions.push(eq(segmentEligibilityRules.segmentCode, segmentCode));
    if (productId) conditions.push(eq(segmentEligibilityRules.productId, productId));

    const where = and(...conditions);

    const rows: SegmentEligibilityRuleRow[] = await (tx as any).select().from(segmentEligibilityRules)
      .where(where)
      .orderBy(segmentEligibilityRules.createdAt)
      .limit(limit)
      .offset(offset);

    const countResult = await (tx as any).select({ count: sql<number>`count(*)::int` })
      .from(segmentEligibilityRules)
      .where(where);

    return {
      data: rows.map(toView),
      total: (countResult as Array<{ count: number }>)[0]?.count ?? 0,
    };
  }) as any;
}

export async function listBySegment(tenantId: string, segmentCode: string): Promise<SegmentEligibilityRuleView[]> {
  const rows: SegmentEligibilityRuleRow[] = await scopedRead((tx) =>
    tx.select().from(segmentEligibilityRules)
      .where(and(
        eq(segmentEligibilityRules.tenantId, tenantId),
        eq(segmentEligibilityRules.segmentCode, segmentCode),
      )) as any,
  ) as any;
  return rows.map(toView);
}

export async function insert(
  tx: any,
  data: typeof segmentEligibilityRules.$inferInsert,
): Promise<void> {
  await tx.insert(segmentEligibilityRules).values(data)
    .onConflictDoNothing();
}

export async function updateWithVersion(
  tx: any,
  id: string,
  tenantId: string,
  fields: { eligible?: boolean; channelOverride?: string[] | null },
  version: number,
  actorId: string,
): Promise<boolean> {
  const result = await tx.update(segmentEligibilityRules)
    .set({
      ...fields,
      updatedBy: actorId,
      updatedAt: new Date(),
      version: sql`${segmentEligibilityRules.version} + 1`,
    })
    .where(and(
      eq(segmentEligibilityRules.id, id),
      eq(segmentEligibilityRules.tenantId, tenantId),
      eq(segmentEligibilityRules.version, version),
    ))
    .returning({ id: segmentEligibilityRules.id });
  return result.length > 0;
}

export async function softDelete(
  tx: any,
  id: string,
  tenantId: string,
): Promise<boolean> {
  const result = await tx.delete(segmentEligibilityRules)
    .where(and(
      eq(segmentEligibilityRules.id, id),
      eq(segmentEligibilityRules.tenantId, tenantId),
    ))
    .returning({ id: segmentEligibilityRules.id });
  return result.length > 0;
}
