/**
 * activations/repo.ts — CDP-012 database operations for activation runs.
 */
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { activations, type ActivationRow, type ActivationInsert } from "./schema.js";

export function toView(r: ActivationRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    segmentId: r.segmentId,
    channel: r.channel,
    status: r.status,
    audienceCount: r.audienceCount,
    startedAt: r.startedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    version: r.version,
  };
}

export type ActivationView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<ActivationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(activations)
      .where(and(eq(activations.id, id), eq(activations.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: { channel?: string; status?: string; segmentId?: string } = {},
): Promise<{ rows: ActivationRow[]; total: number }> {
  const conditions: SQL[] = [eq(activations.tenantId, tenantId)];
  if (filters.channel !== undefined) conditions.push(eq(activations.channel, filters.channel));
  if (filters.status !== undefined) conditions.push(eq(activations.status, filters.status));
  if (filters.segmentId !== undefined) conditions.push(eq(activations.segmentId, filters.segmentId));
  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(activations)
      .where(where)
      .orderBy(desc(activations.id))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(activations).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: ActivationInsert): Promise<void> {
  await tx.insert(activations).values(row);
}

/** Advance a run's status under optimistic locking; false when the version moved on. */
export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  currentVersion: number,
  patch: { status: string; startedAt?: Date; completedAt?: Date; audienceCount?: number },
): Promise<boolean> {
  const result = await tx
    .update(activations)
    .set({ ...patch, version: sql`${activations.version} + 1` })
    .where(and(
      eq(activations.id, id),
      eq(activations.tenantId, tenantId),
      eq(activations.version, currentVersion),
    ))
    .returning({ id: activations.id });
  return result.length > 0;
}

/**
 * Re-snapshot the audience of runs that have not been dispatched yet.
 *
 * A `pending` run has not been handed to its channel, so its recorded reach should still
 * track the segment. Anything past `pending` is deliberately left alone: the snapshot on a
 * dispatched run is the evidence of what that run actually sent, and rewriting it would
 * make a completed run unreconcilable (see the column comment in schema.ts).
 *
 * Returns the ids it touched so the caller can report them on the emitted event.
 */
export async function refreshPendingAudience(
  tx: ScopedTx,
  tenantId: string,
  segmentId: string,
  audienceCount: number,
): Promise<string[]> {
  const result = await tx
    .update(activations)
    .set({ audienceCount, version: sql`${activations.version} + 1` })
    .where(and(
      eq(activations.tenantId, tenantId),
      eq(activations.segmentId, segmentId),
      eq(activations.status, "pending"),
    ))
    .returning({ id: activations.id });
  return result.map((r) => r.id);
}
