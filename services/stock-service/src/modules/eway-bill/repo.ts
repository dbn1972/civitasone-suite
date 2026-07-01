import { eq, and, desc } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { ewayBills, type EwayBillRow, type EwayBillInsert } from "./schema.js";

export async function insertEwayBill(tx: typeof db, row: EwayBillInsert): Promise<void> {
  await tx.insert(ewayBills).values(row);
}

export async function updateEwayBillStatus(
  tx: typeof db,
  id: string,
  tenantId: string,
  fields: Partial<Pick<EwayBillRow, "ewbNo" | "validUntil" | "status" | "errorMessage" | "vehicleNo" | "transportMode" | "updatedBy" | "version">>,
): Promise<void> {
  await tx
    .update(ewayBills)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(ewayBills.id, id), eq(ewayBills.tenantId, tenantId)));
}

export async function findById(tenantId: string, id: string): Promise<EwayBillRow | undefined> {
  const result = await cache.getOrLoad<EwayBillRow | null>(
    `stock:${tenantId}:eway_bill:${id}`,
    async () => {
      const rows = await db
        .select()
        .from(ewayBills)
        .where(and(eq(ewayBills.id, id), eq(ewayBills.tenantId, tenantId)))
        .limit(1);
      return rows[0] ?? null;
    },
  );
  return result ?? undefined;
}

export async function findByTenant(
  tenantId: string,
  opts: { status?: string | undefined; limit: number; offset: number },
): Promise<EwayBillRow[]> {
  const conditions = [eq(ewayBills.tenantId, tenantId)];
  if (opts.status) {
    conditions.push(eq(ewayBills.status, opts.status));
  }
  return db
    .select()
    .from(ewayBills)
    .where(and(...conditions))
    .orderBy(desc(ewayBills.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);
}
