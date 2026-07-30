import { and, desc, eq, sql } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  hrmsBoardDecisionIntake,
  type BoardDecisionIntakeRow,
  type BoardDecisionIntakeInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * Idempotently insert a pending-review intake row. Duplicate delivery of the
 * same (tenant_id, decision_id) is a no-op (ON CONFLICT DO NOTHING), so a
 * replayed `meeting.decision.hr` never creates a second inbox item.
 * Returns true when a new row was inserted, false when it already existed.
 */
export async function insertIntakeIdempotent(
  tx: Writer, row: BoardDecisionIntakeInsert,
): Promise<boolean> {
  const inserted = await tx.insert(hrmsBoardDecisionIntake)
    .values(row)
    .onConflictDoNothing({
      target: [hrmsBoardDecisionIntake.tenantId, hrmsBoardDecisionIntake.decisionId],
    })
    .returning({ id: hrmsBoardDecisionIntake.id });
  return inserted.length > 0;
}

export async function findById(tenantId: string, id: string): Promise<BoardDecisionIntakeRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsBoardDecisionIntake)
    .where(and(eq(hrmsBoardDecisionIntake.tenantId, tenantId), eq(hrmsBoardDecisionIntake.id, id)))
    .limit(1));
  return rows[0] ?? null;
}

export async function listByStatus(
  tenantId: string, status = "pending_review", limit = 200,
): Promise<BoardDecisionIntakeRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsBoardDecisionIntake)
    .where(and(
      eq(hrmsBoardDecisionIntake.tenantId, tenantId),
      eq(hrmsBoardDecisionIntake.status, status),
    ))
    .orderBy(desc(hrmsBoardDecisionIntake.createdAt))
    .limit(limit));
}

/**
 * Transition a pending item to accepted/rejected with an optimistic-lock guard
 * on `version`. Only a still-pending item can be reviewed (status guard in the
 * WHERE clause), so two concurrent reviews cannot both win.
 */
export async function review(
  tx: Writer, tenantId: string, id: string,
  to: "accepted" | "rejected", reviewedBy: string, note: string | null,
  expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsBoardDecisionIntake)
    .set({
      status: to,
      reviewedBy,
      reviewedAt: new Date(),
      note,
      version: sql`${hrmsBoardDecisionIntake.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(hrmsBoardDecisionIntake.tenantId, tenantId),
      eq(hrmsBoardDecisionIntake.id, id),
      eq(hrmsBoardDecisionIntake.status, "pending_review"),
      eq(hrmsBoardDecisionIntake.version, expectedVersion),
    ));
  if (((res as { rowCount?: number; count?: number }).rowCount ?? (res as { count?: number }).count ?? 0) === 0) {
    throw new HttpError(409, "VERSION_CONFLICT",
      "intake item was already reviewed or modified; reload and retry");
  }
}
