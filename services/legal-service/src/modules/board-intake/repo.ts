import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  legalBoardDecisionIntake,
  type BoardDecisionIntakeRow,
  type BoardDecisionIntakeInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * Idempotently insert a pending-review intake row. Duplicate delivery of the
 * same (tenant_id, decision_id) is a no-op, so a replayed
 * `meeting.decision.legal` never creates a second inbox item.
 * Returns true when a new row was inserted, false when it already existed.
 */
export async function insertIntakeIdempotent(
  tx: Writer, row: BoardDecisionIntakeInsert,
): Promise<boolean> {
  const inserted = await tx.insert(legalBoardDecisionIntake)
    .values(row)
    .onConflictDoNothing({
      target: [legalBoardDecisionIntake.tenantId, legalBoardDecisionIntake.decisionId],
    })
    .returning({ id: legalBoardDecisionIntake.id });
  return inserted.length > 0;
}

export async function findById(tenantId: string, id: string): Promise<BoardDecisionIntakeRow | null> {
  const rows = await db.transaction(async (tx) =>
    tx.select().from(legalBoardDecisionIntake)
      .where(and(eq(legalBoardDecisionIntake.tenantId, tenantId), eq(legalBoardDecisionIntake.id, id)))
      .limit(1));
  return rows[0] ?? null;
}

export async function listByStatus(
  tenantId: string, status = "pending_review", limit = 200,
): Promise<BoardDecisionIntakeRow[]> {
  return db.transaction(async (tx) =>
    tx.select().from(legalBoardDecisionIntake)
      .where(and(
        eq(legalBoardDecisionIntake.tenantId, tenantId),
        eq(legalBoardDecisionIntake.status, status),
      ))
      .orderBy(desc(legalBoardDecisionIntake.createdAt))
      .limit(limit));
}

/**
 * Transition a pending item to accepted/rejected with an optimistic-lock guard
 * on `version`. Only a still-pending item can be reviewed.
 */
export async function review(
  tx: Writer, tenantId: string, id: string,
  to: "accepted" | "rejected", reviewedBy: string, note: string | null,
  expectedVersion: number,
): Promise<void> {
  const res = await tx.update(legalBoardDecisionIntake)
    .set({
      status: to,
      reviewedBy,
      reviewedAt: new Date(),
      note,
      version: sql`${legalBoardDecisionIntake.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(legalBoardDecisionIntake.tenantId, tenantId),
      eq(legalBoardDecisionIntake.id, id),
      eq(legalBoardDecisionIntake.status, "pending_review"),
      eq(legalBoardDecisionIntake.version, expectedVersion),
    ));
  if ((res as { rowCount?: number }).rowCount === 0) {
    throw new HttpError(409, "VERSION_CONFLICT",
      "intake item was already reviewed or modified; reload and retry");
  }
}
