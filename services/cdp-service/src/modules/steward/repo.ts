/**
 * steward/repo.ts — Database operations for the merge review queue.
 */
import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { mergeQueue, type MergeQueueRow, type MergeQueueInsert } from "./schema.js";

export function toView(r: MergeQueueRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    sourceProfileId: r.sourceProfileId,
    targetProfileId: r.targetProfileId,
    confidence: r.confidence,
    matchReason: r.matchReason,
    status: r.status,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionReason: r.decisionReason,
    createdAt: r.createdAt.toISOString(),
  };
}

export type MergeQueueView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<MergeQueueRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(mergeQueue)
      .where(and(eq(mergeQueue.id, id), eq(mergeQueue.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByStatus(
  tenantId: string,
  limit: number,
  offset: number,
  status?: string,
): Promise<{ rows: MergeQueueRow[]; total: number }> {
  const conditions = [eq(mergeQueue.tenantId, tenantId)];
  if (status) {
    conditions.push(eq(mergeQueue.status, status));
  }
  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(mergeQueue)
      .where(where)
      .orderBy(desc(mergeQueue.createdAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(mergeQueue).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function insert(tx: ScopedTx, row: MergeQueueInsert): Promise<void> {
  await tx.insert(mergeQueue).values(row);
}

export async function decide(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  decision: "approved" | "rejected",
  decidedBy: string,
  reason?: string,
): Promise<boolean> {
  const result = await tx
    .update(mergeQueue)
    .set({
      status: decision,
      decidedBy,
      decidedAt: new Date(),
      decisionReason: reason ?? null,
      updatedBy: decidedBy,
      version: sql`${mergeQueue.version} + 1`,
    })
    .where(and(eq(mergeQueue.id, id), eq(mergeQueue.tenantId, tenantId), eq(mergeQueue.status, "pending")))
    .returning({ id: mergeQueue.id });
  return result.length > 0;
}
