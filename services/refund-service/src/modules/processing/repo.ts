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
  return scopedRead((tx) =>
    tx.select().from(refundApprovals)
      .where(and(
        eq(refundApprovals.tenantId, tenantId),
        eq(refundApprovals.requestId, requestId),
      ))
      .orderBy(desc(refundApprovals.createdAt)),
  );
}

export async function getMaxApprovalLevel(requestId: string, tenantId: string): Promise<number> {
  const rows = await scopedRead((tx) =>
    tx.select({ level: refundApprovals.approvalLevel }).from(refundApprovals)
      .where(and(
        eq(refundApprovals.tenantId, tenantId),
        eq(refundApprovals.requestId, requestId),
        eq(refundApprovals.decision, "approved"),
      ))
      .orderBy(desc(refundApprovals.approvalLevel))
      .limit(1),
  );
  return rows[0]?.level ?? 0;
}

export async function insertApproval(tx: ScopedTx, row: RefundApprovalInsert): Promise<void> {
  await tx.insert(refundApprovals).values(row);
}
