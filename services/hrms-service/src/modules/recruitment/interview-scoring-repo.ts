import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { hrmsInterviews, hrmsInterviewScores, type InterviewScoreRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type InterviewRow = typeof hrmsInterviews.$inferSelect;

export async function findInterview(tenantId: string, id: string): Promise<InterviewRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsInterviews)
    .where(and(eq(hrmsInterviews.tenantId, tenantId), eq(hrmsInterviews.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function updateInterview(
  tx: Writer, tenantId: string, id: string, patch: Partial<typeof hrmsInterviews.$inferInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsInterviews)
    .set({ ...patch, version: sql`${hrmsInterviews.version} + 1` })
    .where(and(eq(hrmsInterviews.tenantId, tenantId), eq(hrmsInterviews.id, id), eq(hrmsInterviews.version, expectedVersion)));
  if ((res as { rowCount?: number }).rowCount === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "interview was modified by another request; reload and retry");
  }
}

export async function findScore(tenantId: string, interviewId: string, interviewerId: string): Promise<InterviewScoreRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsInterviewScores)
    .where(and(
      eq(hrmsInterviewScores.tenantId, tenantId),
      eq(hrmsInterviewScores.interviewId, interviewId),
      eq(hrmsInterviewScores.interviewerId, interviewerId),
    )).limit(1));
  return rows[0] ?? null;
}

export async function listScores(tenantId: string, interviewId: string): Promise<InterviewScoreRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsInterviewScores)
    .where(and(eq(hrmsInterviewScores.tenantId, tenantId), eq(hrmsInterviewScores.interviewId, interviewId)))
    .orderBy(hrmsInterviewScores.createdAt));
}

/** Insert an interviewer's submitted score (unique per interview+interviewer). */
export async function insertScore(
  tx: Writer,
  row: { tenantId: string; interviewId: string; interviewerId: string; scores: Record<string, number>; overallScore: number; comments: string | null },
): Promise<void> {
  await tx.insert(hrmsInterviewScores).values({
    tenantId: row.tenantId, interviewId: row.interviewId, interviewerId: row.interviewerId,
    scores: row.scores, overallScore: row.overallScore, comments: row.comments,
    submitted: true, submittedAt: new Date(),
  });
}
