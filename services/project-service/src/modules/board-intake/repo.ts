import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  projectBoardDecisionIntake,
  type BoardDecisionIntakeRow,
  type BoardDecisionIntakeInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * Idempotently insert a pending-review intake row. Duplicate delivery of the
 * same (tenant_id, decision_id) is a no-op, so a replayed
 * `meeting.decision.project` never creates a second inbox item.
 * Returns true when a new row was inserted, false when it already existed.
 */
export async function insertIntakeIdempotent(
  tx: Writer, row: BoardDecisionIntakeInsert,
): Promise<boolean> {
  const inserted = await tx.insert(projectBoardDecisionIntake)
    .values(row)
    .onConflictDoNothing({
      target: [projectBoardDecisionIntake.tenantId, projectBoardDecisionIntake.decisionId],
    })
    .returning({ id: projectBoardDecisionIntake.id });
  return inserted.length > 0;
}

export async function findById(tenantId: string, id: string): Promise<BoardDecisionIntakeRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(projectBoardDecisionIntake)
    .where(and(eq(projectBoardDecisionIntake.tenantId, tenantId), eq(projectBoardDecisionIntake.id, id)))
    .limit(1));
  return rows[0] ?? null;
}

export async function listByStatus(
  tenantId: string, status = "pending_review", limit = 200,
): Promise<BoardDecisionIntakeRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(projectBoardDecisionIntake)
    .where(and(
      eq(projectBoardDecisionIntake.tenantId, tenantId),
      eq(projectBoardDecisionIntake.status, status),
    ))
    .orderBy(desc(projectBoardDecisionIntake.createdAt))
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
  const res = await tx.update(projectBoardDecisionIntake)
    .set({
      status: to,
      reviewedBy,
      reviewedAt: new Date(),
      note,
      version: sql`${projectBoardDecisionIntake.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(projectBoardDecisionIntake.tenantId, tenantId),
      eq(projectBoardDecisionIntake.id, id),
      eq(projectBoardDecisionIntake.status, "pending_review"),
      eq(projectBoardDecisionIntake.version, expectedVersion),
    ));
  if ((res as { rowCount?: number }).rowCount === 0) {
    throw new HttpError(409, "VERSION_CONFLICT",
      "intake item was already reviewed or modified; reload and retry");
  }
}
