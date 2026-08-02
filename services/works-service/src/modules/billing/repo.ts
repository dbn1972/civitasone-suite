import { eq, and, desc } from "drizzle-orm";
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

/** Tenant-wide bills register, newest first — backs the FE billing list page. */
export async function listBills(tenantId: string, page: number, pageSize: number) {
  return scopedRead(async (tx) => {
    return tx.select().from(bills)
      .where(eq(bills.tenantId, tenantId))
      .orderBy(desc(bills.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  });
}
