import { and, eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { auditRisks, type RiskRow } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<RiskRow | null> {
  const rows = await db.select().from(auditRisks).where(and(eq(auditRisks.id, id), eq(auditRisks.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function listByTenant(tenantId: string, limit: number): Promise<RiskRow[]> {
  return db.select().from(auditRisks)
    .where(eq(auditRisks.tenantId, tenantId))
    .orderBy(desc(auditRisks.createdAt))
    .limit(limit);
}
