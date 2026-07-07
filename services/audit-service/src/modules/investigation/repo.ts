import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { investigations, type InvestigationRow } from "./schema.js";

export async function listInvestigations(tenantId: string, limit = 50, offset = 0): Promise<InvestigationRow[]> {
  return db.select().from(investigations)
    .where(eq(investigations.tenantId, tenantId))
    .limit(limit)
    .offset(offset);
}

export async function listInvestigationsCount(tenantId: string): Promise<number> {
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(investigations)
    .where(eq(investigations.tenantId, tenantId));
  return rows[0]?.count ?? 0;
}

export async function findInvestigationById(id: string, tenantId: string): Promise<InvestigationRow | null> {
  const rows = await db.select().from(investigations)
    .where(and(eq(investigations.id, id), eq(investigations.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}
