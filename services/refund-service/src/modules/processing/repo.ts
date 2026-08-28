import { eq, and, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { refundApprovals, type RefundApprovalRow, type RefundApprovalInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<RefundApprovalRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(refundApprovals)
      .where(and(eq(refundApprovals.id, id), eq(refundApprovals.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByRequest(requestId: string, tenantId: string): Promise<RefundApprovalRow[]> {
  return scopedRead((tx) => listByRequestQuery(tx, requestId, tenantId));
}

/** Same lookup, scoped to an existing transaction (see `listByRequest`). */
export async function listByRequestTx(tx: ScopedTx, requestId: string, tenantId: string): Promise<RefundApprovalRow[]> {
  return listByRequestQuery(tx, requestId, tenantId);
}

function listByRequestQuery(tx: ScopedTx, requestId: string, tenantId: string) {
  return tx.select().from(refundApprovals)
    .where(and(
      eq(refundApprovals.tenantId, tenantId),
      eq(refundApprovals.requestId, requestId),
    ))
    .orderBy(desc(refundApprovals.createdAt));
}

/**
 * SEQ-1: only a CURRENT-round "approved" row counts toward the max level —
 * see `supersedeApprovals`, which flips prior-round approvals to
 * "superseded" the moment a request is returned for correction. Without
 * that pairing, this query alone would still find the stale row and this
 * function would still be wrong; the fix is the two working together.
 */
export async function getMaxApprovalLevel(requestId: string, tenantId: string): Promise<number> {
  const rows = await scopedRead((tx) => getMaxApprovalLevelQuery(tx, requestId, tenantId));
  return rows[0]?.level ?? 0;
}

/** Same lookup, scoped to an existing transaction (see `getMaxApprovalLevel`). */
export async function getMaxApprovalLevelTx(tx: ScopedTx, requestId: string, tenantId: string): Promise<number> {
  const rows = await getMaxApprovalLevelQuery(tx, requestId, tenantId);
  return rows[0]?.level ?? 0;
}

function getMaxApprovalLevelQuery(tx: ScopedTx, requestId: string, tenantId: string) {
  return tx.select({ level: refundApprovals.approvalLevel }).from(refundApprovals)
    .where(and(
      eq(refundApprovals.tenantId, tenantId),
      eq(refundApprovals.requestId, requestId),
      eq(refundApprovals.decision, "approved"),
    ))
    .orderBy(desc(refundApprovals.approvalLevel))
    .limit(1);
}

export async function insertApproval(tx: ScopedTx, row: RefundApprovalInsert): Promise<void> {
  await tx.insert(refundApprovals).values(row);
}

/**
 * SEQ-1: called from processing/consumer.ts's returnRequest, in the same
 * transaction as inserting the "returned" decision row. Marks every
 * currently-"approved" row for this request as "superseded" so a fresh
 * review cycle starts clean: getMaxApprovalLevel goes back to 0, a level-1
 * re-review is expected again (not rejected as out-of-sequence), and a
 * level-2 approval is no longer reachable without a fresh level-1 first.
 * The superseded rows themselves are kept, not deleted — GET
 * /processing/approvals still shows the full history, including which
 * approvals were superseded by which return.
 */
export async function supersedeApprovals(
  tx: ScopedTx,
  requestId: string,
  tenantId: string,
  updatedBy: string,
): Promise<void> {
  await tx.update(refundApprovals)
    .set({ decision: "superseded", updatedBy, updatedAt: new Date() })
    .where(and(
      eq(refundApprovals.tenantId, tenantId),
      eq(refundApprovals.requestId, requestId),
      eq(refundApprovals.decision, "approved"),
    ));
}
