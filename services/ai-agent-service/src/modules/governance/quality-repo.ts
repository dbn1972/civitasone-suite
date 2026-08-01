/**
 * governance/quality-repo.ts — DB operations for AG-004 interaction quality.
 *
 * numeric columns stay STRINGS end-to-end: no Number(...) anywhere in this file.
 */
import { eq, and, sql, desc, asc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import {
  interactionQuality,
  type InteractionQualityRow,
  type InteractionQualityInsert,
} from "./quality-schema.js";

export function toView(r: InteractionQualityRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    conversationId: r.conversationId,
    turnId: r.turnId,
    relevance: r.relevance,
    coherence: r.coherence,
    safety: r.safety,
    overall: r.overall,
    flagged: r.flagged,
    flagReason: r.flagReason,
    scoredAt: r.scoredAt.toISOString(),
    version: r.version,
  };
}

export type QualityView = ReturnType<typeof toView>;

export async function findByTurn(
  tenantId: string,
  conversationId: string,
  turnId: string,
): Promise<InteractionQualityRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(interactionQuality)
      .where(and(
        eq(interactionQuality.tenantId, tenantId),
        eq(interactionQuality.conversationId, conversationId),
        eq(interactionQuality.turnId, turnId),
      ))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByConversation(
  tenantId: string,
  conversationId: string,
  limit: number,
  offset: number,
): Promise<{ rows: InteractionQualityRow[]; total: number }> {
  const where = and(
    eq(interactionQuality.tenantId, tenantId),
    eq(interactionQuality.conversationId, conversationId),
  );

  const rows = await scopedRead((tx) =>
    tx.select().from(interactionQuality)
      .where(where)
      .orderBy(asc(interactionQuality.scoredAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(interactionQuality).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

/** Flagged interactions awaiting human review, newest first. */
export async function listFlagged(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: InteractionQualityRow[]; total: number }> {
  const where = and(eq(interactionQuality.tenantId, tenantId), eq(interactionQuality.flagged, true));

  const rows = await scopedRead((tx) =>
    tx.select().from(interactionQuality)
      .where(where)
      .orderBy(desc(interactionQuality.scoredAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(interactionQuality).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

/**
 * Upsert on (tenant_id, conversation_id, turn_id). Re-scoring the same turn must
 * not create a second row — the scorer runs on 100% of interactions and may be
 * replayed after a consumer retry.
 */
export async function upsert(tx: ScopedTx, row: InteractionQualityInsert): Promise<void> {
  await tx
    .insert(interactionQuality)
    .values(row)
    .onConflictDoUpdate({
      target: [
        interactionQuality.tenantId,
        interactionQuality.conversationId,
        interactionQuality.turnId,
      ],
      set: {
        relevance: row.relevance ?? null,
        coherence: row.coherence ?? null,
        safety: row.safety ?? null,
        overall: row.overall ?? null,
        flagged: row.flagged ?? false,
        flagReason: row.flagReason ?? null,
        scoredAt: new Date(),
        updatedAt: new Date(),
        updatedBy: row.updatedBy,
        version: sql`${interactionQuality.version} + 1`,
      },
    });
}
