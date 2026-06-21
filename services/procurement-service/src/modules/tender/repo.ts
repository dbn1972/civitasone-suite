import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementTenders, procurementTenderBids, type TenderRow } from "./schema.js";

export async function findTenderById(id: string): Promise<TenderRow | null> {
  const rows = await db.select().from(procurementTenders).where(eq(procurementTenders.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listTendersByTenant(tenantId: string, limit: number, offset: number): Promise<TenderRow[]> {
  return db.select().from(procurementTenders)
    .where(eq(procurementTenders.tenantId, tenantId))
    .limit(limit)
    .offset(offset);
}

export async function findBidsByTender(tenderId: string): Promise<(typeof procurementTenderBids.$inferSelect)[]> {
  return db.select().from(procurementTenderBids).where(eq(procurementTenderBids.tenderId, tenderId));
}
