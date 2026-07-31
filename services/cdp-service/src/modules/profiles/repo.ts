/**
 * profiles/repo.ts — Database operations for golden profiles.
 */
import { eq, and, ilike, sql, desc, type SQL, inArray } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { profiles, type ProfileRow, type ProfileInsert } from "./schema.js";

export function toView(r: ProfileRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    profileType: r.profileType,
    attributes: r.attributes,
    sourceLineage: r.sourceLineage,
    mergedFromIds: r.mergedFromIds,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type ProfileView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<ProfileRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(profiles).where(and(eq(profiles.id, id), eq(profiles.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export interface ListFilters {
  search?: string;
  profileType?: string;
  segmentId?: string;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ rows: ProfileRow[]; total: number }> {
  const conditions: SQL[] = [eq(profiles.tenantId, tenantId)];

  if (filters.search) {
    const q = `%${filters.search}%`;
    conditions.push(sql`${profiles.attributes}::text ILIKE ${q}`);
  }
  if (filters.profileType) {
    conditions.push(eq(profiles.profileType, filters.profileType));
  }

  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(profiles).where(where).orderBy(desc(profiles.updatedAt)).limit(limit).offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(profiles).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function insert(tx: ScopedTx, row: ProfileInsert): Promise<void> {
  await tx.insert(profiles).values(row);
}

export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<ProfileInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(profiles)
    .set({ ...patch, updatedAt: new Date(), version: sql`${profiles.version} + 1` })
    .where(and(eq(profiles.id, id), eq(profiles.tenantId, tenantId), eq(profiles.version, currentVersion)))
    .returning({ id: profiles.id });
  return result.length > 0;
}

export async function markMerged(
  tx: ScopedTx,
  winnerId: string,
  loserId: string,
  tenantId: string,
  mergedAttributes: Record<string, unknown>,
  mergedLineage: Array<{ source: string; sourceId: string; timestamp: string }>,
  loserMergedFromIds: string[],
): Promise<void> {
  // Update winner with merged data
  await tx
    .update(profiles)
    .set({
      attributes: mergedAttributes,
      sourceLineage: mergedLineage,
      mergedFromIds: sql`${profiles.mergedFromIds} || ${JSON.stringify([loserId])}::jsonb`,
      updatedAt: new Date(),
      version: sql`${profiles.version} + 1`,
    })
    .where(and(eq(profiles.id, winnerId), eq(profiles.tenantId, tenantId)));

  // Soft-mark loser as merged by setting profileType to "merged"
  await tx
    .update(profiles)
    .set({
      profileType: "merged",
      attributes: { mergedInto: winnerId },
      updatedAt: new Date(),
      version: sql`${profiles.version} + 1`,
    })
    .where(and(eq(profiles.id, loserId), eq(profiles.tenantId, tenantId)));
}

export async function findByIds(ids: string[], tenantId: string): Promise<ProfileRow[]> {
  if (ids.length === 0) return [];
  return scopedRead((tx) =>
    tx.select().from(profiles).where(and(inArray(profiles.id, ids), eq(profiles.tenantId, tenantId))),
  );
}
