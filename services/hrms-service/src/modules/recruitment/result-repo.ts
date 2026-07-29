import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  hrmsAssessmentEvaluations, hrmsAssessmentResultEvents,
  type EvaluationRow, type EvaluationInsert, type ResultEventRow,
} from "./result-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/** Upsert one evaluator's score for a (attempt, question) — re-scoring replaces. */
export async function saveEvaluation(tx: Writer, row: EvaluationInsert): Promise<void> {
  await tx.insert(hrmsAssessmentEvaluations).values(row)
    .onConflictDoUpdate({
      target: [hrmsAssessmentEvaluations.attemptId, hrmsAssessmentEvaluations.questionId, hrmsAssessmentEvaluations.evaluatorId],
      set: { score: row.score as never, maxMarks: row.maxMarks as never, remarks: row.remarks as never, updatedAt: new Date() },
    });
}

export async function listEvaluations(tenantId: string, attemptId: string): Promise<EvaluationRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsAssessmentEvaluations)
    .where(and(eq(hrmsAssessmentEvaluations.tenantId, tenantId), eq(hrmsAssessmentEvaluations.attemptId, attemptId))));
}

export async function insertResultEvent(
  tx: Writer,
  ev: { tenantId: string; attemptId: string; action: string; detail?: unknown; actorId: string },
): Promise<void> {
  await tx.insert(hrmsAssessmentResultEvents).values({
    tenantId: ev.tenantId, attemptId: ev.attemptId, action: ev.action, detail: (ev.detail ?? {}) as never, actorId: ev.actorId,
  });
}

export async function listResultEvents(tenantId: string, attemptId: string): Promise<ResultEventRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsAssessmentResultEvents)
    .where(and(eq(hrmsAssessmentResultEvents.tenantId, tenantId), eq(hrmsAssessmentResultEvents.attemptId, attemptId)))
    .orderBy(desc(hrmsAssessmentResultEvents.createdAt)));
}
