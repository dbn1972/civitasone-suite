import { eq, and, desc, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsInterviews, hrmsInterviewComms, type InterviewCommRow, type InterviewCommInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
type InterviewRow = typeof hrmsInterviews.$inferSelect;

function affected(res: unknown): number {
  const r = res as { rowCount?: number; count?: number };
  return r.rowCount ?? r.count ?? 0;
}

export async function findInterview(tenantId: string, id: string): Promise<InterviewRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsInterviews)
    .where(and(eq(hrmsInterviews.tenantId, tenantId), eq(hrmsInterviews.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function insertComm(tx: Writer, row: InterviewCommInsert): Promise<void> {
  await tx.insert(hrmsInterviewComms).values(row);
}

/** Prior comm for a tenant + idempotency key (retry dedup). */
export async function findByIdempotencyKey(tenantId: string, key: string): Promise<InterviewCommRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsInterviewComms)
    .where(and(eq(hrmsInterviewComms.tenantId, tenantId), eq(hrmsInterviewComms.idempotencyKey, key))).limit(1));
  return rows[0] ?? null;
}

export async function listComms(tenantId: string, interviewId: string): Promise<InterviewCommRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsInterviewComms)
    .where(and(eq(hrmsInterviewComms.tenantId, tenantId), eq(hrmsInterviewComms.interviewId, interviewId)))
    .orderBy(desc(hrmsInterviewComms.createdAt)));
}

/** Reschedule: set new date/time under an optimistic-version guard. Returns false on version miss. */
export async function rescheduleInterview(
  tx: Writer, tenantId: string, id: string, scheduledDate: string, scheduledTime: string, actorId: string, expectedVersion: number,
): Promise<boolean> {
  // A reschedule moves the date/time but the interview remains 'scheduled'
  // (the status CHECK domain has no 'rescheduled' value; the comms log records
  // that a reschedule happened).
  const res = await tx.update(hrmsInterviews)
    .set({ scheduledDate, scheduledTime, version: sql`${hrmsInterviews.version} + 1` })
    .where(and(eq(hrmsInterviews.tenantId, tenantId), eq(hrmsInterviews.id, id), eq(hrmsInterviews.version, expectedVersion)));
  void actorId;
  return affected(res) > 0;
}

/** Cancel: set status=cancelled under an optimistic-version guard. Returns false on version miss. */
export async function cancelInterview(
  tx: Writer, tenantId: string, id: string, expectedVersion: number,
): Promise<boolean> {
  const res = await tx.update(hrmsInterviews)
    .set({ status: "cancelled", version: sql`${hrmsInterviews.version} + 1` })
    .where(and(eq(hrmsInterviews.tenantId, tenantId), eq(hrmsInterviews.id, id), eq(hrmsInterviews.version, expectedVersion)));
  return affected(res) > 0;
}
