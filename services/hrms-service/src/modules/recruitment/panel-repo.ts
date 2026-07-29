import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { hrmsInterviews, hrmsInterviewPanelists, type InterviewRow, type PanelistRow, type PanelistInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

export async function findInterview(tenantId: string, id: string): Promise<InterviewRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsInterviews)
    .where(and(eq(hrmsInterviews.tenantId, tenantId), eq(hrmsInterviews.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function updateInterview(tx: Writer, tenantId: string, id: string, patch: Partial<typeof hrmsInterviews.$inferInsert>, expectedVersion: number): Promise<void> {
  const res = await tx.update(hrmsInterviews)
    .set({ ...patch, version: sql`${hrmsInterviews.version} + 1` })
    .where(and(eq(hrmsInterviews.tenantId, tenantId), eq(hrmsInterviews.id, id), eq(hrmsInterviews.version, expectedVersion)));
  if ((res as { rowCount?: number }).rowCount === 0) throw new HttpError(409, "VERSION_CONFLICT", "interview was modified by another request; reload and retry");
}

/**
 * Bump the parent interview's version. Called on EVERY panel mutation so the
 * outcome's version-locked write (which validates panel readiness beforehand)
 * conflicts (409) if the panel changed after readiness was computed — binding the
 * recorded outcome to the exact panel that cleared the COI gate (R-RA-0138).
 */
export async function touchInterviewVersion(tx: Writer, tenantId: string, id: string): Promise<void> {
  await tx.update(hrmsInterviews)
    .set({ version: sql`${hrmsInterviews.version} + 1` })
    .where(and(eq(hrmsInterviews.tenantId, tenantId), eq(hrmsInterviews.id, id)));
}

/** Full replacement of an interview's panel (delete then insert), in one txn. */
export async function setPanelists(tx: Writer, tenantId: string, interviewId: string, rows: PanelistInsert[]): Promise<void> {
  await tx.delete(hrmsInterviewPanelists)
    .where(and(eq(hrmsInterviewPanelists.tenantId, tenantId), eq(hrmsInterviewPanelists.interviewId, interviewId)));
  if (rows.length > 0) await tx.insert(hrmsInterviewPanelists).values(rows);
  await touchInterviewVersion(tx, tenantId, interviewId);
}

export async function listPanelists(tenantId: string, interviewId: string): Promise<PanelistRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsInterviewPanelists)
    .where(and(eq(hrmsInterviewPanelists.tenantId, tenantId), eq(hrmsInterviewPanelists.interviewId, interviewId))));
}

export async function recusePanelist(tx: Writer, tenantId: string, interviewId: string, memberId: string): Promise<number> {
  const res = await tx.update(hrmsInterviewPanelists)
    .set({ recused: true, recusedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(hrmsInterviewPanelists.tenantId, tenantId), eq(hrmsInterviewPanelists.interviewId, interviewId), eq(hrmsInterviewPanelists.memberId, memberId)));
  const n = (res as { rowCount?: number }).rowCount ?? 0;
  if (n > 0) await touchInterviewVersion(tx, tenantId, interviewId);
  return n;
}
