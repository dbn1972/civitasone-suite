import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { grantSchemes, grantEligibilityCriteria, type SchemeRow, type SchemeInsert, type CriterionRow, type CriterionInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findSchemeById(id: string, tenantId: string): Promise<SchemeRow | null> {
  const rows = await db.select().from(grantSchemes)
    .where(and(eq(grantSchemes.id, id), eq(grantSchemes.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findCriteriaByScheme(schemeId: string): Promise<CriterionRow[]> {
  return db.select().from(grantEligibilityCriteria).where(eq(grantEligibilityCriteria.schemeId, schemeId));
}

export async function insertScheme(tx: Writer, row: SchemeInsert): Promise<void> {
  await tx.insert(grantSchemes).values(row);
}

export async function listSchemesByTenant(tenantId: string, limit: number): Promise<SchemeRow[]> {
  return db.select().from(grantSchemes).where(eq(grantSchemes.tenantId, tenantId)).limit(limit);
}

export async function insertCriterion(tx: Writer, row: CriterionInsert): Promise<void> {
  await tx.insert(grantEligibilityCriteria).values(row);
}

/**
 * P0-5 atomic scheme budget reservation. Increments disbursed_minor by amountMinor
 * ONLY IF the result stays within budget_minor (and matches tenant/scheme). Runs in
 * the caller transaction so it is consistent with the disbursement write. Returns
 * true when the reservation succeeded, false when it would overspend the budget
 * (or the scheme row does not exist for this tenant). No-throw by design — the
 * caller decides how to reject.
 */
export async function reserveSchemeBudget(
  tx: Writer,
  schemeId: string,
  tenantId: string,
  amountMinor: bigint,
): Promise<boolean> {
  const rows = await (tx as typeof db)
    .update(grantSchemes)
    .set({
      disbursedMinor: sql`${grantSchemes.disbursedMinor} + ${amountMinor}`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(grantSchemes.id, schemeId),
      eq(grantSchemes.tenantId, tenantId),
      sql`${grantSchemes.disbursedMinor} + ${amountMinor} <= ${grantSchemes.budgetMinor}`,
    ))
    .returning({ id: grantSchemes.id });
  return rows.length > 0;
}
