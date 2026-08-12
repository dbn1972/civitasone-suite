import { eq, and, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { tradeScrutinyRecords, type TradeScrutinyRow, type TradeScrutinyInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<TradeScrutinyRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(tradeScrutinyRecords)
      .where(and(eq(tradeScrutinyRecords.id, id), eq(tradeScrutinyRecords.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByApplication(applicationId: string, tenantId: string): Promise<TradeScrutinyRow[]> {
  return scopedRead((tx) =>
    tx.select().from(tradeScrutinyRecords)
      .where(and(eq(tradeScrutinyRecords.tenantId, tenantId), eq(tradeScrutinyRecords.applicationId, applicationId)))
      .orderBy(desc(tradeScrutinyRecords.createdAt)),
  );
}

export async function insertScrutiny(tx: ScopedTx, row: TradeScrutinyInsert): Promise<void> {
  await tx.insert(tradeScrutinyRecords).values(row);
}

export async function completeScrutiny(
  tx: ScopedTx, id: string, tenantId: string, status: string,
  findings: Record<string, unknown>, deficiencyDetails: string | null, updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(tradeScrutinyRecords)
    .set({ status, findings, deficiencyDetails, completedAt: new Date(), updatedBy, updatedAt: new Date() })
    .where(and(eq(tradeScrutinyRecords.id, id), eq(tradeScrutinyRecords.tenantId, tenantId)))
    .returning({ id: tradeScrutinyRecords.id });
  return result.length > 0;
}
