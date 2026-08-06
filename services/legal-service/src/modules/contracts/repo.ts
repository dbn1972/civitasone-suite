import { desc, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { legalContractReviews, legalClearances, type ReviewRow } from "./schema.js";

export async function listReviews(tenantId: string, limit = 100): Promise<ReviewRow[]> {
  return db.transaction(async (tx) =>
    tx.select().from(legalContractReviews)
      .where(eq(legalContractReviews.tenantId, tenantId))
      .orderBy(desc(legalContractReviews.createdAt))
      .limit(limit));
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findReviewByIdTx(tx: Writer, id: string): Promise<ReviewRow | null> {
  const rows = await (tx as typeof db).select().from(legalContractReviews).where(eq(legalContractReviews.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertReview(tx: Writer, row: typeof legalContractReviews.$inferInsert): Promise<void> {
  await tx.insert(legalContractReviews).values(row);
}

export async function updateReview(tx: Writer, id: string, patch: Partial<typeof legalContractReviews.$inferInsert>): Promise<void> {
  await tx.update(legalContractReviews).set({ ...patch, updatedAt: new Date() }).where(eq(legalContractReviews.id, id));
}

export async function insertClearance(tx: Writer, row: typeof legalClearances.$inferInsert): Promise<void> {
  await tx.insert(legalClearances).values(row);
}
