import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsInterviewResponses, type InterviewResponseRow, type InterviewResponseInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

function affected(res: unknown): number {
  const r = res as { rowCount?: number; count?: number };
  return r.rowCount ?? r.count ?? 0;
}

export async function insertResponse(tx: Writer, row: InterviewResponseInsert): Promise<void> {
  await tx.insert(hrmsInterviewResponses).values(row);
}

export async function findResponse(tenantId: string, id: string): Promise<InterviewResponseRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsInterviewResponses)
    .where(and(eq(hrmsInterviewResponses.tenantId, tenantId), eq(hrmsInterviewResponses.id, id))).limit(1));
  return rows[0] ?? null;
}

/** An open (pending) reschedule request for an interview, if any. */
export async function findPendingForInterview(tenantId: string, interviewId: string): Promise<InterviewResponseRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsInterviewResponses)
    .where(and(
      eq(hrmsInterviewResponses.tenantId, tenantId),
      eq(hrmsInterviewResponses.interviewId, interviewId),
      eq(hrmsInterviewResponses.status, "pending"),
    )).limit(1));
  return rows[0] ?? null;
}

export async function listForInterview(tenantId: string, interviewId: string): Promise<InterviewResponseRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsInterviewResponses)
    .where(and(eq(hrmsInterviewResponses.tenantId, tenantId), eq(hrmsInterviewResponses.interviewId, interviewId)))
    .orderBy(desc(hrmsInterviewResponses.createdAt)));
}

/** Transition a pending reschedule request (approve/decline), version-guarded. */
export async function setResponseStatus(
  tx: Writer, tenantId: string, id: string, patch: Partial<InterviewResponseInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsInterviewResponses)
    .set({ ...patch, version: expectedVersion + 1 })
    .where(and(
      eq(hrmsInterviewResponses.tenantId, tenantId),
      eq(hrmsInterviewResponses.id, id),
      eq(hrmsInterviewResponses.version, expectedVersion),
    ));
  if (affected(res) === 0) throw new Error("VERSION_CONFLICT");
}
