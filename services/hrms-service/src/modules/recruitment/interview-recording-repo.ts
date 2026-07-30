import { eq, and, desc, lt, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsInterviewRecordings, type InterviewRecordingRow, type InterviewRecordingInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

function affected(res: unknown): number {
  const r = res as { rowCount?: number; count?: number };
  return r.rowCount ?? r.count ?? 0;
}

export async function insertRecording(tx: Writer, row: InterviewRecordingInsert): Promise<void> {
  await tx.insert(hrmsInterviewRecordings).values(row);
}

export async function findRecording(tenantId: string, id: string): Promise<InterviewRecordingRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsInterviewRecordings)
    .where(and(eq(hrmsInterviewRecordings.tenantId, tenantId), eq(hrmsInterviewRecordings.id, id))).limit(1));
  return rows[0] ?? null;
}

/** Active recordings for an interview (deleted ones are excluded). */
export async function listForInterview(tenantId: string, interviewId: string): Promise<InterviewRecordingRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsInterviewRecordings)
    .where(and(
      eq(hrmsInterviewRecordings.tenantId, tenantId),
      eq(hrmsInterviewRecordings.interviewId, interviewId),
      eq(hrmsInterviewRecordings.status, "active"),
    ))
    .orderBy(desc(hrmsInterviewRecordings.createdAt)));
}

/**
 * Active recordings whose retention has FULLY elapsed by asOf (purge candidates).
 * Uses `< asOf` so an artefact is retained THROUGH its retention_until day and
 * only becomes purgeable the day after — matching interview-recording.isExpired.
 */
export async function listExpired(tenantId: string, asOf: string, limit = 200): Promise<InterviewRecordingRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsInterviewRecordings)
    .where(and(
      eq(hrmsInterviewRecordings.tenantId, tenantId),
      eq(hrmsInterviewRecordings.status, "active"),
      lt(hrmsInterviewRecordings.retentionUntil, asOf),
    ))
    .limit(limit));
}

/**
 * Soft-delete a recording (erasure / retention purge): mark deleted under an
 * optimistic-version guard. Returns false when absent or already deleted.
 */
export async function softDelete(
  tx: Writer, tenantId: string, id: string, actorId: string, expectedVersion: number,
): Promise<boolean> {
  const res = await tx.update(hrmsInterviewRecordings)
    .set({ status: "deleted", deletedAt: new Date(), deletedBy: actorId, version: sql`${hrmsInterviewRecordings.version} + 1` })
    .where(and(
      eq(hrmsInterviewRecordings.tenantId, tenantId),
      eq(hrmsInterviewRecordings.id, id),
      eq(hrmsInterviewRecordings.status, "active"),
      eq(hrmsInterviewRecordings.version, expectedVersion),
    ));
  return affected(res) > 0;
}
