/** PC-006 — reads/writes for bundle pricing approvals. */
import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import {
  bundleApprovals,
  type BundleApprovalRow,
  type BundleApprovalInsert,
} from "../products/governance-schema.js";

export async function listApprovals(
  bundleId: string,
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: BundleApprovalRow[]; total: number }> {
  const where = and(eq(bundleApprovals.tenantId, tenantId), eq(bundleApprovals.bundleId, bundleId))!;
  const [rows, cnt] = await scopedRead(async (tx) => {
    const data = await tx.select().from(bundleApprovals).where(where)
      .orderBy(desc(bundleApprovals.createdAt)).limit(limit).offset(offset);
    const total = await tx.select({ count: sql<number>`count(*)::int` }).from(bundleApprovals).where(where);
    return [data, total] as const;
  });
  return { rows, total: cnt[0]?.count ?? 0 };
}

export async function findApprovalById(approvalId: string, tenantId: string): Promise<BundleApprovalRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(bundleApprovals)
      .where(and(eq(bundleApprovals.id, approvalId), eq(bundleApprovals.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/** Is there already an undecided request for this bundle? */
export async function findPendingApproval(bundleId: string, tenantId: string): Promise<BundleApprovalRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(bundleApprovals)
      .where(and(
        eq(bundleApprovals.tenantId, tenantId),
        eq(bundleApprovals.bundleId, bundleId),
        eq(bundleApprovals.status, "pending"),
      ))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function insertApproval(tx: ScopedTx, row: BundleApprovalInsert): Promise<void> {
  await tx.insert(bundleApprovals).values(row);
}

/** Optimistic-locked decision write. Returns false when no row matched → 409. */
export async function decideApproval(
  tx: ScopedTx,
  approvalId: string,
  tenantId: string,
  patch: Partial<BundleApprovalInsert>,
  expectedVersion: number,
): Promise<boolean> {
  const result = await tx.update(bundleApprovals)
    .set({ ...patch, updatedAt: new Date(), version: sql`${bundleApprovals.version} + 1` })
    .where(and(
      eq(bundleApprovals.id, approvalId),
      eq(bundleApprovals.tenantId, tenantId),
      eq(bundleApprovals.version, expectedVersion),
    ))
    .returning({ id: bundleApprovals.id });
  return result.length > 0;
}
