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
  // Merge lineage is transitive: absorbing a profile also absorbs whatever that
  // profile had previously absorbed, otherwise the older ids are silently lost.
  const appendedIds = [...new Set([loserId, ...loserMergedFromIds])];

  // Each id is bound as `text` and assembled by jsonb_build_array. A parameter
  // whose Postgres-inferred type is jsonb gets JSON-encoded by the driver on top
  // of the encoding the caller already applied, which is how the previous
  // `|| ${JSON.stringify([loserId])}::jsonb` form stored a jsonb *string*
  // (["[\"<uuid>\"]"]) instead of a jsonb array. A text parameter is passed
  // through verbatim, so the array is built server-side and unambiguously.
  const appendedArray = sql`jsonb_build_array(${sql.join(
    appendedIds.map((id) => sql`${id}::text`),
    sql`, `,
  )})`;

  // Set-union server-side: keeps the winner's existing lineage, adds the new
  // ids, and stays idempotent if the same merge is replayed. DISTINCT makes the
  // element order value-sorted rather than insertion-ordered — lineage is a set,
  // nothing depends on its order.
  const unionedLineage = sql`(
    SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(${profiles.mergedFromIds}, '[]'::jsonb) || ${appendedArray}) AS elem
  )`;

  // Update winner with merged data
  await tx
    .update(profiles)
    .set({
      attributes: mergedAttributes,
      sourceLineage: mergedLineage,
      mergedFromIds: unionedLineage,
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

/**
 * Read a profile inside the caller's transaction.
 *
 * `findById` opens its own transaction (scopedRead), which a consumer cannot reuse once it
 * has claimed the message: the read, the idempotency claim and the write have to share one
 * transaction or a crash between them leaves the message marked processed with no write.
 */
export async function findByIdTx(tx: ScopedTx, id: string, tenantId: string): Promise<ProfileRow | null> {
  const rows = await tx.select().from(profiles)
    .where(and(eq(profiles.id, id), eq(profiles.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}
