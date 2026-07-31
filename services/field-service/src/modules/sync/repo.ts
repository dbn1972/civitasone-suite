/**
 * sync/repo.ts — Database operations for sync queue.
 */
import { eq, and, sql, desc, gt } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { syncQueue, type SyncQueueRow, type SyncQueueInsert } from "./schema.js";

export function toView(r: SyncQueueRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    agentId: r.agentId,
    entityType: r.entityType,
    entityId: r.entityId,
    operation: r.operation,
    payload: r.payload,
    clientTimestamp: r.clientTimestamp.toISOString(),
    clientVersion: r.clientVersion,
    status: r.status,
    attempts: r.attempts,
    lastError: r.lastError,
    processedAt: r.processedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export type SyncQueueView = ReturnType<typeof toView>;

export async function insertBatch(tx: ScopedTx, rows: SyncQueueInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(syncQueue).values(rows);
}

export async function markProcessed(
  tx: ScopedTx,
  id: string,
  tenantId: string,
): Promise<boolean> {
  const result = await tx
    .update(syncQueue)
    .set({ status: "processed", processedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(syncQueue.id, id), eq(syncQueue.tenantId, tenantId)))
    .returning({ id: syncQueue.id });
  return result.length > 0;
}

export async function markFailed(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  error: string,
): Promise<void> {
  await tx
    .update(syncQueue)
    .set({
      status: "failed",
      lastError: error,
      attempts: sql`${syncQueue.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(syncQueue.id, id), eq(syncQueue.tenantId, tenantId)));
}

/**
 * Get changes since a given timestamp for a specific agent (pull).
 */
export async function getChangesSince(
  tenantId: string,
  agentId: string,
  since: string,
  limit: number,
): Promise<{ rows: SyncQueueRow[]; total: number }> {
  const where = and(
    eq(syncQueue.tenantId, tenantId),
    eq(syncQueue.agentId, agentId),
    eq(syncQueue.status, "processed"),
    gt(syncQueue.processedAt, new Date(since)),
  );

  const rows = await scopedRead((tx) =>
    tx.select().from(syncQueue).where(where).orderBy(desc(syncQueue.processedAt)).limit(limit),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(syncQueue).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}
