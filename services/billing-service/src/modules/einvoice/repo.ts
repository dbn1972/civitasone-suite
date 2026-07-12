import { eq, and } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { einvoiceRequests, type EInvoiceRequestRow, type EInvoiceRequestInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertRequest(tx: Writer, row: EInvoiceRequestInsert): Promise<void> {
  await tx.insert(einvoiceRequests).values(row);
}

export async function updateRequest(tx: Writer, id: string, patch: Partial<EInvoiceRequestInsert>): Promise<void> {
  await tx.update(einvoiceRequests).set({ ...patch, updatedAt: new Date() }).where(eq(einvoiceRequests.id, id));
}

export async function findByIdTx(tx: Writer, id: string): Promise<EInvoiceRequestRow | undefined> {
  const rows = await tx.select().from(einvoiceRequests).where(eq(einvoiceRequests.id, id)).limit(1);
  return rows[0];
}

export async function findById(id: string): Promise<EInvoiceRequestRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(einvoiceRequests).where(eq(einvoiceRequests.id, id)).limit(1));
  return rows[0];
}

export async function findByInvoiceId(invoiceId: string, tenantId: string): Promise<EInvoiceRequestRow | undefined> {
  const rows = await scopedRead((tx) => tx
    .select()
    .from(einvoiceRequests)
    .where(and(eq(einvoiceRequests.invoiceId, invoiceId), eq(einvoiceRequests.tenantId, tenantId)))
    .limit(1));
  return rows[0];
}

export async function findByIrn(irn: string): Promise<EInvoiceRequestRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(einvoiceRequests).where(eq(einvoiceRequests.irn, irn)).limit(1));
  return rows[0];
}
