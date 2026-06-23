import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementVendors, procurementEmpanelment, type VendorRow, type VendorInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findVendorById(id: string): Promise<VendorRow | null> {
  const rows = await db.select().from(procurementVendors).where(eq(procurementVendors.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findVendorByIdTx(tx: Writer, id: string): Promise<VendorRow | null> {
  const rows = await (tx as typeof db).select().from(procurementVendors).where(eq(procurementVendors.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listVendorsByTenant(tenantId: string, limit = 100, offset = 0): Promise<VendorRow[]> {
  return db.select().from(procurementVendors).where(eq(procurementVendors.tenantId, tenantId)).limit(limit).offset(offset);
}

export async function insertVendor(tx: Writer, row: VendorInsert): Promise<void> {
  await tx.insert(procurementVendors).values(row);
}

export async function updateVendor(tx: Writer, id: string, patch: Partial<VendorInsert>): Promise<void> {
  await tx.update(procurementVendors).set({ ...patch, updatedAt: new Date() }).where(eq(procurementVendors.id, id));
}

export async function insertEmpanelment(tx: Writer, row: typeof procurementEmpanelment.$inferInsert): Promise<void> {
  await tx.insert(procurementEmpanelment).values(row);
}
