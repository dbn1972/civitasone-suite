/**
 * dsar/repo.ts — CDP-011 database operations for the DSAR register.
 */
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { dsarRequests, type DsarRequestRow, type DsarRequestInsert } from "./schema.js";

export function toView(r: DsarRequestRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    profileId: r.profileId,
    requestType: r.requestType,
    status: r.status,
    reason: r.reason,
    requestedAt: r.requestedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    version: r.version,
  };
}

export type DsarView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<DsarRequestRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(dsarRequests)
      .where(and(eq(dsarRequests.id, id), eq(dsarRequests.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: { status?: string; profileId?: string } = {},
): Promise<{ rows: DsarRequestRow[]; total: number }> {
  const conditions: SQL[] = [eq(dsarRequests.tenantId, tenantId)];
  if (filters.status !== undefined) conditions.push(eq(dsarRequests.status, filters.status));
  if (filters.profileId !== undefined) conditions.push(eq(dsarRequests.profileId, filters.profileId));
  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(dsarRequests)
      .where(where)
      .orderBy(desc(dsarRequests.requestedAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(dsarRequests).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: DsarRequestInsert): Promise<void> {
  await tx.insert(dsarRequests).values(row);
}

/**
 * Mark a request completed under optimistic locking. Returns false when the version
 * no longer matches — the caller turns that into a 409 rather than emitting a second
 * purge event for a request someone else already discharged.
 */
export async function complete(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  currentVersion: number,
  completedAt: Date,
): Promise<boolean> {
  const result = await tx
    .update(dsarRequests)
    .set({ status: "completed", completedAt, version: sql`${dsarRequests.version} + 1` })
    .where(and(
      eq(dsarRequests.id, id),
      eq(dsarRequests.tenantId, tenantId),
      eq(dsarRequests.version, currentVersion),
    ))
    .returning({ id: dsarRequests.id });
  return result.length > 0;
}
