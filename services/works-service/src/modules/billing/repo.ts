import { eq, and } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { measurementBooks, bills } from "./schema.js";

export async function getMb(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(measurementBooks)
      .where(and(eq(measurementBooks.id, id), eq(measurementBooks.tenantId, tenantId)));
    return rows[0] ?? null;
  });
}

export async function getBill(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(bills)
      .where(and(eq(bills.id, id), eq(bills.tenantId, tenantId)));
    return rows[0] ?? null;
  });
}

export async function listBillsForWork(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(bills)
      .where(and(eq(bills.tenantId, tenantId), eq(bills.workId, workId)));
  });
}
