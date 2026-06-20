import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { grantSchemes, grantEligibilityCriteria, type SchemeRow, type SchemeInsert, type CriterionRow, type CriterionInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findSchemeById(id: string): Promise<SchemeRow | null> {
  const rows = await db.select().from(grantSchemes).where(eq(grantSchemes.id, id)).limit(1);
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
