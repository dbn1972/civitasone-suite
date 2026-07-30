import { eq, and, desc, or, gte, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { hrmsJobOpenings } from "./schema.js";

type JobOpeningInsert = typeof hrmsJobOpenings.$inferInsert;
import {
  hrmsRequisitions, hrmsRequisitionApprovals,
  type RequisitionRow, type RequisitionInsert, type RequisitionApprovalRow,
} from "./requisition-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertRequisition(tx: Writer, row: RequisitionInsert): Promise<void> {
  await tx.insert(hrmsRequisitions).values(row);
}

export async function findRequisition(tenantId: string, id: string): Promise<RequisitionRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsRequisitions)
    .where(and(eq(hrmsRequisitions.tenantId, tenantId), eq(hrmsRequisitions.id, id))).limit(1));
  return rows[0] ?? null;
}

/**
 * List requisitions. Confidential ones are visible only to their creator or to a
 * privileged viewer (HR/super admin) — R-RA-0058. `privileged` collapses the
 * confidential filter; otherwise confidential rows are limited to `viewerId`.
 */
export async function listRequisitions(
  tenantId: string, opts: { status?: string; privileged: boolean; viewerId: string }, limit = 200,
): Promise<RequisitionRow[]> {
  const conds = [eq(hrmsRequisitions.tenantId, tenantId)];
  if (opts.status) conds.push(eq(hrmsRequisitions.status, opts.status));
  if (!opts.privileged) {
    conds.push(or(eq(hrmsRequisitions.confidential, false), eq(hrmsRequisitions.createdBy, opts.viewerId))!);
  }
  return scopedRead((tx) => tx.select().from(hrmsRequisitions)
    .where(and(...conds)).orderBy(desc(hrmsRequisitions.createdAt)).limit(limit));
}

export async function updateRequisition(
  tx: Writer, tenantId: string, id: string, patch: Partial<RequisitionInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsRequisitions)
    .set({ ...patch, version: sql`${hrmsRequisitions.version} + 1`, updatedAt: new Date() })
    .where(and(eq(hrmsRequisitions.tenantId, tenantId), eq(hrmsRequisitions.id, id), eq(hrmsRequisitions.version, expectedVersion)));
  if (((res as { rowCount?: number; count?: number }).rowCount ?? (res as { count?: number }).count ?? 0) === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "requisition was modified by another request; reload and retry");
  }
}

export async function insertApproval(
  tx: Writer, row: { tenantId: string; requisitionId: string; stage: number; stageRole: string; action: string; comments: string | null; actorId: string },
): Promise<void> {
  await tx.insert(hrmsRequisitionApprovals).values(row);
}

/** Has this actor already recorded an 'approve' on this requisition WITHIN the
 *  current submission cycle? Used to enforce that each approval stage is cleared
 *  by a DISTINCT person. Scoped to approvals at/after `since` (the requisition's
 *  latest submittedAt) so that a return→correct→resubmit starts a fresh cycle and
 *  an earlier-stage approver is not permanently barred from the corrected run. */
export async function actorAlreadyApproved(
  tenantId: string, requisitionId: string, actorId: string, since: Date | null,
): Promise<boolean> {
  const conds = [
    eq(hrmsRequisitionApprovals.tenantId, tenantId),
    eq(hrmsRequisitionApprovals.requisitionId, requisitionId),
    eq(hrmsRequisitionApprovals.actorId, actorId),
    eq(hrmsRequisitionApprovals.action, "approve"),
  ];
  if (since) conds.push(gte(hrmsRequisitionApprovals.createdAt, since));
  const rows = await scopedRead((tx) => tx.select({ id: hrmsRequisitionApprovals.id })
    .from(hrmsRequisitionApprovals).where(and(...conds)).limit(1));
  return rows.length > 0;
}

export async function listApprovals(tenantId: string, requisitionId: string): Promise<RequisitionApprovalRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsRequisitionApprovals)
    .where(and(eq(hrmsRequisitionApprovals.tenantId, tenantId), eq(hrmsRequisitionApprovals.requisitionId, requisitionId)))
    .orderBy(hrmsRequisitionApprovals.createdAt));
}

/** Insert into the existing job_openings table when a requisition publishes. */
export async function insertJobOpening(tx: Writer, row: JobOpeningInsert): Promise<void> {
  await tx.insert(hrmsJobOpenings).values(row);
}
