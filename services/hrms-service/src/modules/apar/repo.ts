import { eq, and, asc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { hrmsAppraisals, type AppraisalRow, type AppraisalInsert } from "../appraisals/schema.js";
import {
  hrmsAparScores, hrmsAparStageHistory,
  type AparScoreRow, type AparScoreInsert, type AparStageHistoryInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update">;

export async function findAppraisal(id: string, tenantId: string): Promise<AppraisalRow | null> {
  const rows = await db.select().from(hrmsAppraisals)
    .where(and(eq(hrmsAppraisals.id, id), eq(hrmsAppraisals.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function updateAppraisal(tx: Writer, id: string, patch: Partial<AppraisalInsert>): Promise<void> {
  await tx.update(hrmsAppraisals).set({ ...patch, updatedAt: new Date() }).where(eq(hrmsAppraisals.id, id));
}

export async function upsertScore(tx: Writer, row: AparScoreInsert): Promise<void> {
  await tx.insert(hrmsAparScores).values(row).onConflictDoUpdate({
    target: [hrmsAparScores.appraisalId, hrmsAparScores.attribute],
    set: { weight: row.weight ?? "1", score: row.score, remarks: row.remarks ?? null, scoredBy: row.scoredBy, updatedAt: new Date() },
  });
}

export async function listScores(tenantId: string, appraisalId: string): Promise<AparScoreRow[]> {
  return db.select().from(hrmsAparScores)
    .where(and(eq(hrmsAparScores.tenantId, tenantId), eq(hrmsAparScores.appraisalId, appraisalId)))
    .orderBy(asc(hrmsAparScores.attribute));
}

export async function appendHistory(tx: Writer, row: AparStageHistoryInsert): Promise<void> {
  await tx.insert(hrmsAparStageHistory).values(row);
}

export async function listHistory(tenantId: string, appraisalId: string) {
  return db.select().from(hrmsAparStageHistory)
    .where(and(eq(hrmsAparStageHistory.tenantId, tenantId), eq(hrmsAparStageHistory.appraisalId, appraisalId)))
    .orderBy(asc(hrmsAparStageHistory.createdAt));
}
