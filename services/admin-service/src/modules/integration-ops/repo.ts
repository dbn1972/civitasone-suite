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
  patch: { status: string; requeuedAt?: Date | null; discardedAt?: Date | null; actionedBy?: string | null },
): Promise<DeadLetterRow | undefined> {
  const set: Record<string, unknown> = {
    status: patch.status,
    updatedAt: new Date(),
    version: sql`${deadLetter.version} + 1`,
  };
  if (patch.requeuedAt !== undefined) set.requeuedAt = patch.requeuedAt;
  if (patch.discardedAt !== undefined) set.discardedAt = patch.discardedAt;
  if (patch.actionedBy !== undefined) set.actionedBy = patch.actionedBy;
  const rows = (await (tx as typeof db)
    .update(deadLetter)
    .set(set)
    // Guard status='pending' so two concurrent requeues can't both act.
    .where(and(eq(deadLetter.tenantId, tenantId), eq(deadLetter.id, id), eq(deadLetter.status, "pending")))
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
