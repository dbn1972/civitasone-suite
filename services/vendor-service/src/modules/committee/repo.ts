import { eq, and, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { vendorCommitteeReviews, type CommitteeReviewRow, type CommitteeReviewInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<CommitteeReviewRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(vendorCommitteeReviews)
      .where(and(eq(vendorCommitteeReviews.id, id), eq(vendorCommitteeReviews.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByRegistration(registrationId: string, tenantId: string): Promise<CommitteeReviewRow[]> {
  return scopedRead((tx) =>
    tx.select().from(vendorCommitteeReviews)
      .where(and(
        eq(vendorCommitteeReviews.tenantId, tenantId),
        eq(vendorCommitteeReviews.registrationId, registrationId),
      ))
      .orderBy(desc(vendorCommitteeReviews.createdAt)),
  );
}

export async function insertReview(tx: ScopedTx, row: CommitteeReviewInsert): Promise<void> {
  await tx.insert(vendorCommitteeReviews).values(row);
}

export async function completeReview(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  findings: Record<string, unknown>,
  recommendation: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(vendorCommitteeReviews)
    .set({
      status,
      findings,
      recommendation,
      reviewedAt: new Date(),
      updatedBy,
      updatedAt: new Date(),
    })
    .where(and(eq(vendorCommitteeReviews.id, id), eq(vendorCommitteeReviews.tenantId, tenantId)))
    .returning({ id: vendorCommitteeReviews.id });
  return result.length > 0;
}
