import { eq, and, desc, inArray } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { einvoiceRequests, type EInvoiceRequestRow, type EInvoiceRequestInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertRequest(tx: Writer, row: EInvoiceRequestInsert): Promise<void> {
  await tx.insert(einvoiceRequests).values(row);
}

export async function updateRequest(tx: Writer, id: string, patch: Partial<EInvoiceRequestInsert>): Promise<void> {
  await tx.update(einvoiceRequests).set({ ...patch, updatedAt: new Date() }).where(eq(einvoiceRequests.id, id));
}

/**
 * Status-guarded update (CLOS3-S4-01/02): applies `patch` only while the row is still in one of
 * `allowed`, so a late failure can never overwrite a `generated` / `cancelled` row.
 * Returns whether a row was updated.
 */
export async function updateRequestWhenStatus(
  tx: Writer,
  id: string,
  allowed: readonly string[],
  patch: Partial<EInvoiceRequestInsert>,
): Promise<boolean> {
  const rows = await tx
    .update(einvoiceRequests)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(einvoiceRequests.id, id), inArray(einvoiceRequests.status, [...allowed])))
    .returning({ id: einvoiceRequests.id });
  return rows.length > 0;
}

/** Newest request for an invoice, row-locked for the rest of the transaction (cancel claim). */
export async function findLatestByInvoiceIdForUpdate(
  tx: Writer,
  invoiceId: string,
  tenantId: string,
): Promise<EInvoiceRequestRow | undefined> {
  const rows = await tx
    .select()
    .from(einvoiceRequests)
    .where(and(eq(einvoiceRequests.invoiceId, invoiceId), eq(einvoiceRequests.tenantId, tenantId)))
    .orderBy(desc(einvoiceRequests.createdAt))
    .limit(1)
    .for("update");
  return rows[0];
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
