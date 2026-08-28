import { eq, and, desc } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { measurementBooks, bills, measurements } from "./schema.js";

export async function getMb(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(measurementBooks)
      .where(and(eq(measurementBooks.id, id), eq(measurementBooks.tenantId, tenantId)));
    return rows[0] ?? null;
  });
}

/** All measurement lines recorded against a given MB — the real, queryable
 * basis for a bill's "value of work actually measured". */
export async function listMeasurementsByMb(tenantId: string, mbId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(measurements)
      .where(and(eq(measurements.tenantId, tenantId), eq(measurements.mbId, mbId)));
  });
}

/** Every measurement recorded against a BoQ item, across all MBs — used to
 * enforce the cumulative FR-BIL-011 billing ceiling synchronously at the
 * route (see billing/routes.ts POST /measurements). */
export async function listMeasurementsByBoqItem(tenantId: string, boqItemId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(measurements)
      .where(and(eq(measurements.tenantId, tenantId), eq(measurements.boqItemId, boqItemId)));
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

/**
 * Code-review fix (double-billing gap): every bill that already cites this
 * mbId — used to compute how much of the MB's measured value has already
 * been billed, so a second bill against the same MB can't independently
 * pass the same measured-value check the first one did.
 */
export async function listBillsByMb(tenantId: string, mbId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(bills)
      .where(and(eq(bills.tenantId, tenantId), eq(bills.mbId, mbId)));
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
