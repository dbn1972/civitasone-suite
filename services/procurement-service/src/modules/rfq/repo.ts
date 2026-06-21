import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementRfqs, procurementRfqItems, type RfqRow } from "./schema.js";

export async function findRfqById(id: string): Promise<RfqRow | null> {
  const rows = await db.select().from(procurementRfqs).where(eq(procurementRfqs.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listRfqsByTenant(tenantId: string, limit: number, offset: number): Promise<RfqRow[]> {
  return db.select().from(procurementRfqs)
    .where(eq(procurementRfqs.tenantId, tenantId))
    .limit(limit)
    .offset(offset);
}

export async function findRfqItemsByRfq(rfqId: string): Promise<(typeof procurementRfqItems.$inferSelect)[]> {
  return db.select().from(procurementRfqItems).where(eq(procurementRfqItems.rfqId, rfqId));
}
