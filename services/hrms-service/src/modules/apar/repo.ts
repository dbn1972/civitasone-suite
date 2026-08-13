import { eq, and, asc, desc, sql } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { hrmsAppraisals, type AppraisalRow, type AppraisalInsert } from "../appraisals/schema.js";
import {
  hrmsAparScores, hrmsAparStageHistory,
  type AparScoreRow, type AparScoreInsert, type AparStageHistoryInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update">;

export async function listAppraisals(tenantId: string, limit = 100): Promise<AppraisalRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsAppraisals)
    .where(eq(hrmsAppraisals.tenantId, tenantId))
    .orderBy(desc(hrmsAppraisals.updatedAt))
    .limit(limit));
}

export async function findAppraisal(id: string, tenantId: string): Promise<AppraisalRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsAppraisals)
    .where(and(eq(hrmsAppraisals.id, id), eq(hrmsAppraisals.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

/**
 * Update an appraisal, ALWAYS incrementing the optimistic-lock `version` column
 * (L4). When `expectedVersion` is supplied the update is GUARDED: the row is
 * only modified if its current version still matches, and a stale write raises
 * a 409 VERSION_CONFLICT instead of silently clobbering a concurrent change.
 */
export async function updateAppraisal(
  tx: Writer,
  id: string,
  patch: Partial<AppraisalInsert>,
  expectedVersion?: number,
): Promise<void> {
  const where =
    expectedVersion !== undefined
      ? and(eq(hrmsAppraisals.id, id), eq(hrmsAppraisals.version, expectedVersion))
      : eq(hrmsAppraisals.id, id);
  const res = await tx
    .update(hrmsAppraisals)
    .set({ ...patch, version: sql`${hrmsAppraisals.version} + 1`, updatedAt: new Date() })
    .where(where);
  if (expectedVersion !== undefined && ((res as { rowCount?: number; count?: number }).rowCount ?? (res as { count?: number }).count ?? 0) === 0) {
    throw new HttpError(409, "VERSION_CONFLICT",
      "appraisal was modified by another request; reload and retry");
  }
}

export async function upsertScore(tx: Writer, row: AparScoreInsert): Promise<void> {
  await tx.insert(hrmsAparScores).values(row).onConflictDoUpdate({
    target: [hrmsAparScores.appraisalId, hrmsAparScores.attribute],
    set: { weight: row.weight ?? "1", score: row.score, remarks: row.remarks ?? null, scoredBy: row.scoredBy, updatedAt: new Date() },
  });
}

export async function listScores(tenantId: string, appraisalId: string, limit = 500): Promise<AparScoreRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsAparScores)
    .where(and(eq(hrmsAparScores.tenantId, tenantId), eq(hrmsAparScores.appraisalId, appraisalId)))
    .orderBy(asc(hrmsAparScores.attribute))
    .limit(limit));
}

export async function appendHistory(tx: Writer, row: AparStageHistoryInsert): Promise<void> {
  await tx.insert(hrmsAparStageHistory).values(row);
}

export async function listHistory(tenantId: string, appraisalId: string, limit = 500) {
  return scopedRead((tx) => tx.select().from(hrmsAparStageHistory)
    .where(and(eq(hrmsAparStageHistory.tenantId, tenantId), eq(hrmsAparStageHistory.appraisalId, appraisalId)))
    .orderBy(asc(hrmsAparStageHistory.createdAt))
    .limit(limit));
}
