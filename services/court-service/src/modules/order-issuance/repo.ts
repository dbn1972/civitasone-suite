import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { orders } from "../order/schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * Read the issuance-relevant state of an existing order for a version-guarded
 * workflow transition. Returns the current status + optimistic-lock version and
 * the maker identity fields (createdBy / signedBy) so the consumer can enforce
 * maker-checker. No insert — orders are created by the base `order` module; this
 * module only advances an existing order through its issuance lifecycle.
 */
export async function getOrderForIssuance(
  tx: Writer, tenantId: string, orderId: string,
): Promise<{ status: string; version: number; createdBy: string | null; signedBy: string | null } | undefined> {
  const rows = await tx.select({
    status:    orders.status,
    version:   orders.version,
    createdBy: orders.createdBy,
    signedBy:  orders.signedBy,
  })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)))
    .limit(1);
  return rows[0];
}
