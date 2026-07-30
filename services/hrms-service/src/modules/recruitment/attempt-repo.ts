import { eq, and, desc, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  hrmsAssessmentSchedules, hrmsAssessmentAttempts, hrmsAssessmentResponses,
  type ScheduleRow, type ScheduleInsert, type AttemptRow, type AttemptInsert,
  type ResponseRow, type ResponseInsert,
} from "./attempt-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ---- schedules ----------------------------------------------------------

export async function insertSchedule(tx: Writer, row: ScheduleInsert): Promise<void> {
  await tx.insert(hrmsAssessmentSchedules).values(row);
}
export async function findSchedule(tenantId: string, id: string): Promise<ScheduleRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsAssessmentSchedules)
    .where(and(eq(hrmsAssessmentSchedules.tenantId, tenantId), eq(hrmsAssessmentSchedules.id, id))).limit(1));
  return rows[0] ?? null;
}
export async function updateSchedule(tx: Writer, tenantId: string, id: string, patch: Partial<ScheduleInsert>, expectedVersion: number): Promise<void> {
  const res = await tx.update(hrmsAssessmentSchedules)
    .set({ ...patch, version: sql`${hrmsAssessmentSchedules.version} + 1`, updatedAt: new Date() })
    .where(and(eq(hrmsAssessmentSchedules.tenantId, tenantId), eq(hrmsAssessmentSchedules.id, id), eq(hrmsAssessmentSchedules.version, expectedVersion)));
  if (((res as { rowCount?: number; count?: number }).rowCount ?? (res as { count?: number }).count ?? 0) === 0) throw new HttpError(409, "VERSION_CONFLICT", "schedule was modified by another request; reload and retry");
}
export async function listSchedules(tenantId: string, filter: { status?: string; blueprintId?: string }, limit: number): Promise<ScheduleRow[]> {
  const conds = [eq(hrmsAssessmentSchedules.tenantId, tenantId)];
  if (filter.status) conds.push(eq(hrmsAssessmentSchedules.status, filter.status));
  if (filter.blueprintId) conds.push(eq(hrmsAssessmentSchedules.blueprintId, filter.blueprintId));
  return scopedRead((tx) => tx.select().from(hrmsAssessmentSchedules).where(and(...conds)).orderBy(desc(hrmsAssessmentSchedules.createdAt)).limit(limit));
}

// ---- attempts -----------------------------------------------------------

export async function insertAttempt(tx: Writer, row: AttemptInsert): Promise<void> {
  await tx.insert(hrmsAssessmentAttempts).values(row);
}
export async function findAttempt(tenantId: string, id: string): Promise<AttemptRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsAssessmentAttempts)
    .where(and(eq(hrmsAssessmentAttempts.tenantId, tenantId), eq(hrmsAssessmentAttempts.id, id))).limit(1));
  return rows[0] ?? null;
}
export async function updateAttempt(tx: Writer, tenantId: string, id: string, patch: Partial<AttemptInsert>, expectedVersion: number): Promise<void> {
  const res = await tx.update(hrmsAssessmentAttempts)
    .set({ ...patch, version: sql`${hrmsAssessmentAttempts.version} + 1`, updatedAt: new Date() })
    .where(and(eq(hrmsAssessmentAttempts.tenantId, tenantId), eq(hrmsAssessmentAttempts.id, id), eq(hrmsAssessmentAttempts.version, expectedVersion)));
  if (((res as { rowCount?: number; count?: number }).rowCount ?? (res as { count?: number }).count ?? 0) === 0) throw new HttpError(409, "VERSION_CONFLICT", "attempt was modified by another request; reload and retry");
}
export async function listAttemptsBySchedule(tenantId: string, scheduleId: string, limit: number): Promise<AttemptRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsAssessmentAttempts)
    .where(and(eq(hrmsAssessmentAttempts.tenantId, tenantId), eq(hrmsAssessmentAttempts.scheduleId, scheduleId)))
    .orderBy(desc(hrmsAssessmentAttempts.createdAt)).limit(limit));
}

// ---- responses ----------------------------------------------------------

/** Auto-save (upsert) a single response, keyed by (attempt, question). R-RA-0130. */
export async function saveResponse(tx: Writer, row: ResponseInsert): Promise<void> {
  await tx.insert(hrmsAssessmentResponses).values(row)
    .onConflictDoUpdate({
      target: [hrmsAssessmentResponses.attemptId, hrmsAssessmentResponses.questionId],
      set: { response: row.response as never, savedAt: new Date() },
    });
}
export async function updateResponseScore(tx: Writer, tenantId: string, attemptId: string, questionId: string, autoScore: number, isCorrect: boolean | null): Promise<void> {
  await tx.update(hrmsAssessmentResponses)
    .set({ autoScore: String(autoScore), isCorrect, evaluatedAt: new Date() })
    .where(and(eq(hrmsAssessmentResponses.tenantId, tenantId), eq(hrmsAssessmentResponses.attemptId, attemptId), eq(hrmsAssessmentResponses.questionId, questionId)));
}
export async function listResponses(tenantId: string, attemptId: string): Promise<ResponseRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsAssessmentResponses)
    .where(and(eq(hrmsAssessmentResponses.tenantId, tenantId), eq(hrmsAssessmentResponses.attemptId, attemptId))));
}
