/**
 * segments/repo.ts — Database operations for segments.
 */
import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { segments, type SegmentRow, type SegmentInsert } from "./schema.js";
import { profiles } from "../profiles/schema.js";
import { buildWhereClause, type SegmentCriteria } from "./domain.js";

export function toView(r: SegmentRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    description: r.description,
    segmentType: r.segmentType,
    criteria: r.criteria,
    status: r.status,
    memberCount: r.memberCount,
    isArchived: r.isArchived,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type SegmentView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<SegmentRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(segments)
      .where(and(eq(segments.id, id), eq(segments.tenantId, tenantId), eq(segments.isArchived, false)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: SegmentRow[]; total: number }> {
  const where = and(eq(segments.tenantId, tenantId), eq(segments.isArchived, false));

  const rows = await scopedRead((tx) =>
    tx.select().from(segments)
      .where(where)
      .orderBy(desc(segments.updatedAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(segments).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function insert(tx: ScopedTx, row: SegmentInsert): Promise<void> {
  await tx.insert(segments).values(row);
}

export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<SegmentInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(segments)
    .set({ ...patch, updatedAt: new Date(), version: sql`${segments.version} + 1` })
    .where(and(eq(segments.id, id), eq(segments.tenantId, tenantId), eq(segments.version, currentVersion)))
    .returning({ id: segments.id });
  return result.length > 0;
}

export async function softDelete(tx: ScopedTx, id: string, tenantId: string, currentVersion: number): Promise<boolean> {
  const result = await tx
    .update(segments)
    .set({ isArchived: true, status: "archived", updatedAt: new Date(), version: sql`${segments.version} + 1` })
    .where(and(eq(segments.id, id), eq(segments.tenantId, tenantId), eq(segments.version, currentVersion)))
    .returning({ id: segments.id });
  return result.length > 0;
}

/**
 * Evaluate segment criteria and return matching profile IDs.
 */
export async function evaluateMembers(
  criteria: SegmentCriteria,
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ profileIds: string[]; total: number }> {
  const where = buildWhereClause(criteria, tenantId);

  const rows = await scopedRead((tx) =>
    tx.select({ id: profiles.id }).from(profiles)
      .where(where)
      .orderBy(desc(profiles.updatedAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(profiles).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { profileIds: rows.map((r) => r.id), total };
}

/**
 * Update the cached member count for a segment.
 */
export async function updateMemberCount(tx: ScopedTx, id: string, tenantId: string, count: number): Promise<void> {
  await tx
    .update(segments)
    .set({ memberCount: count, updatedAt: new Date() })
    .where(and(eq(segments.id, id), eq(segments.tenantId, tenantId)));
}
