import { eq, and, sql } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { eligibilityRules, type EligibilityRuleRow, type EligibilityRuleInsert } from "./schema.js";

export type Writer = { insert: ScopedTx["insert"]; update: ScopedTx["update"]; select: ScopedTx["select"] };

export async function findById(id: string, tenantId: string): Promise<EligibilityRuleRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(eligibilityRules)
      .where(and(eq(eligibilityRules.id, id), eq(eligibilityRules.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByProduct(productId: string, tenantId: string): Promise<EligibilityRuleRow[]> {
  return scopedRead((tx) =>
    tx.select().from(eligibilityRules)
      .where(and(
        eq(eligibilityRules.tenantId, tenantId),
        eq(eligibilityRules.productId, productId),
        eq(eligibilityRules.status, "active"),
      ))
      .orderBy(eligibilityRules.createdAt),
  );
}

export async function listByProducts(productIds: string[], tenantId: string): Promise<EligibilityRuleRow[]> {
  if (productIds.length === 0) return [];
  return scopedRead((tx) =>
    tx.select().from(eligibilityRules)
      .where(and(
        eq(eligibilityRules.tenantId, tenantId),
        sql`${eligibilityRules.productId} = ANY(${productIds})`,
        eq(eligibilityRules.status, "active"),
      ))
      .orderBy(eligibilityRules.productId, eligibilityRules.createdAt),
  );
}

export async function insertRule(tx: Writer, row: EligibilityRuleInsert): Promise<void> {
  await tx.insert(eligibilityRules).values(row);
}

export async function deleteRule(tx: Writer, id: string, tenantId: string): Promise<void> {
  await tx.update(eligibilityRules)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(and(eq(eligibilityRules.id, id), eq(eligibilityRules.tenantId, tenantId)));
}
