import { eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { billingInvoices, billingInvoiceItems, type BillingInvoiceInsert, type BillingInvoiceItemInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertInvoice(tx: Writer, row: BillingInvoiceInsert): Promise<void> {
  await tx.insert(billingInvoices).values(row);
}

export async function insertItem(tx: Writer, row: BillingInvoiceItemInsert): Promise<void> {
  await tx.insert(billingInvoiceItems).values(row);
}

export async function updateInvoice(tx: Writer, id: string, patch: Partial<BillingInvoiceInsert>): Promise<void> {
  await tx.update(billingInvoices).set({ ...patch, updatedAt: new Date() }).where(eq(billingInvoices.id, id));
}

export async function listByTenant(tenantId: string, limit = 100) {
  return db.select().from(billingInvoices).where(eq(billingInvoices.tenantId, tenantId)).orderBy(desc(billingInvoices.createdAt)).limit(limit);
}
