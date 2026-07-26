/**
 * CAP-060 — dead-letter repository. Writes run inside db.transaction (GUC set by
 * the request tenant hook); reads use scopedRead so RLS is enforced.
 */
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { deadLetter, deadLetterAction } from "./schema.js";
import type {
  DeadLetterRow,
  DeadLetterInsert,
  DeadLetterActionRow,
  DeadLetterActionInsert,
} from "./schema.js";

type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * Idempotent ingestion. When message_id is present a repeated failure for the
 * same (tenant,topic,message_id) bumps retry_count and refreshes the error
 * instead of inserting a duplicate.
 */
export async function upsertDeadLetter(tx: Writer, row: DeadLetterInsert): Promise<DeadLetterRow> {
  if (row.messageId) {
    const rows = (await (tx as typeof db)
      .insert(deadLetter)
      .values(row)
      .onConflictDoUpdate({
        target: [deadLetter.tenantId, deadLetter.topic, deadLetter.messageId],
        // The unique index is partial (WHERE message_id IS NOT NULL) — the
        // ON CONFLICT arbiter must carry the same predicate to match it.
        targetWhere: sql`${deadLetter.messageId} IS NOT NULL`,
        set: {
          error: row.error ?? null,
          retryCount: sql`${deadLetter.retryCount} + 1`,
          lastErrorAt: new Date(),
          updatedAt: new Date(),
        },
        setWhere: sql`${deadLetter.status} = 'pending'`,
      })
      .returning()) as DeadLetterRow[];
    if (rows[0]) return rows[0];
    // Conflict hit a non-pending row (already requeued/discarded) — return it.
    const existing = (await (tx as typeof db)
      .select()
      .from(deadLetter)
      .where(
        and(
          eq(deadLetter.tenantId, row.tenantId),
          eq(deadLetter.topic, row.topic),
          eq(deadLetter.messageId, row.messageId),
        ),
      )
      .limit(1)) as DeadLetterRow[];
    return existing[0]!;
  }
  const rows = (await (tx as typeof db).insert(deadLetter).values(row).returning()) as DeadLetterRow[];
  return rows[0]!;
}

export interface DlqFilter {
  status?: string | undefined;
  topic?: string | undefined;
}

export async function listDeadLetters(tenantId: string, filter: DlqFilter = {}, limit = 200): Promise<DeadLetterRow[]> {
  const preds = [eq(deadLetter.tenantId, tenantId)];
  if (filter.status) preds.push(eq(deadLetter.status, filter.status));
  if (filter.topic) preds.push(eq(deadLetter.topic, filter.topic));
  return scopedRead((tx) =>
    tx.select().from(deadLetter).where(and(...preds)).orderBy(desc(deadLetter.lastErrorAt)).limit(limit),
  );
}

export async function getDeadLetter(tenantId: string, id: string): Promise<DeadLetterRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(deadLetter).where(and(eq(deadLetter.tenantId, tenantId), eq(deadLetter.id, id))).limit(1),
  );
  return rows[0] ?? null;
}

export async function getPendingByIds(tx: Writer, tenantId: string, ids: string[]): Promise<DeadLetterRow[]> {
  if (ids.length === 0) return [];
  return (tx as typeof db)
    .select()
    .from(deadLetter)
    .where(and(eq(deadLetter.tenantId, tenantId), eq(deadLetter.status, "pending"), inArray(deadLetter.id, ids))) as Promise<DeadLetterRow[]>;
}

export async function updateStatus(
  tx: Writer,
  tenantId: string,
  id: string,
  patch: { status: string; expectStatus?: string; requeuedAt?: Date | null; discardedAt?: Date | null; actionedBy?: string | null },
): Promise<DeadLetterRow | undefined> {
  const set: Record<string, unknown> = {
    status: patch.status,
    updatedAt: new Date(),
    version: sql`${deadLetter.version} + 1`,
  };
  if (patch.requeuedAt !== undefined) set.requeuedAt = patch.requeuedAt;
  if (patch.discardedAt !== undefined) set.discardedAt = patch.discardedAt;
  if (patch.actionedBy !== undefined) set.actionedBy = patch.actionedBy;
  // CAS guard: only flip when the row is still in the expected source state, so
  // concurrent actors can't both transition it. Default 'pending' (discard path);
  // the requeue finalize passes 'requeuing' to move a claimed row to 'requeued'.
  const expect = patch.expectStatus ?? "pending";
  const rows = (await (tx as typeof db)
    .update(deadLetter)
    .set(set)
    .where(and(eq(deadLetter.tenantId, tenantId), eq(deadLetter.id, id), eq(deadLetter.status, expect)))
    .returning()) as DeadLetterRow[];
  return rows[0];
}

/**
 * Claim a pending dead letter for requeue by atomically flipping it to the
 * interim 'requeuing' state (CAS pending->requeuing). Returns the claimed row
 * on success, or undefined when a concurrent caller already claimed/actioned it
 * (0 rows) — the loser must NOT publish.
 */
export async function claimForRequeue(
  tx: Writer,
  tenantId: string,
  id: string,
): Promise<DeadLetterRow | undefined> {
  const rows = (await (tx as typeof db)
    .update(deadLetter)
    .set({ status: "requeuing", updatedAt: new Date(), version: sql`${deadLetter.version} + 1` })
    .where(and(eq(deadLetter.tenantId, tenantId), eq(deadLetter.id, id), eq(deadLetter.status, "pending")))
    .returning()) as DeadLetterRow[];
  return rows[0];
}

/**
 * Release a claim after a failed publish: flip 'requeuing' back to 'pending' so
 * the message is not lost and can be retried. Guarded so it only touches a row
 * this caller claimed.
 */
export async function revertToPending(
  tx: Writer,
  tenantId: string,
  id: string,
): Promise<DeadLetterRow | undefined> {
  const rows = (await (tx as typeof db)
    .update(deadLetter)
    .set({ status: "pending", updatedAt: new Date(), version: sql`${deadLetter.version} + 1` })
    .where(and(eq(deadLetter.tenantId, tenantId), eq(deadLetter.id, id), eq(deadLetter.status, "requeuing")))
    .returning()) as DeadLetterRow[];
  return rows[0];
}

export async function insertAction(tx: Writer, row: DeadLetterActionInsert): Promise<void> {
  await (tx as typeof db).insert(deadLetterAction).values(row);
}

export async function listActions(tenantId: string, deadLetterId: string): Promise<DeadLetterActionRow[]> {
  return scopedRead((tx) =>
    tx
      .select()
      .from(deadLetterAction)
      .where(and(eq(deadLetterAction.tenantId, tenantId), eq(deadLetterAction.deadLetterId, deadLetterId)))
      .orderBy(desc(deadLetterAction.createdAt)),
  );
}
