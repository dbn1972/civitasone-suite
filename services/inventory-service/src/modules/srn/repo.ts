/**
 * srn module — read-model (query) handlers.
 * All reads go through Redis cache (read-through pattern).
 */
import { cache } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { storeReceiptNotes, type StoreReceiptNoteRow } from "./schema.js";
import { eq, and } from "drizzle-orm";
import { SERVICE, RESOURCE } from "../../topics.js";

export async function getSrn(tenantId: string, id: string): Promise<StoreReceiptNoteRow | null> {
  return cache.getOrLoad(`${SERVICE}:${tenantId}:${RESOURCE.srn}:${id}`, async () => {
    const rows = await scopedRead((tx) => tx.select().from(storeReceiptNotes)
      .where(and(eq(storeReceiptNotes.tenantId, tenantId), eq(storeReceiptNotes.id, id)))
      .limit(1));
    return rows[0] ?? null;
  });
}

/** One SRN per GRN per tenant (enforced by a unique index — see migration 0017). */
export async function findByGrnId(tenantId: string, grnId: string): Promise<StoreReceiptNoteRow | null> {
  return cache.getOrLoad(`${SERVICE}:${tenantId}:${RESOURCE.srn}:by-grn:${grnId}`, async () => {
    const rows = await scopedRead((tx) => tx.select().from(storeReceiptNotes)
      .where(and(eq(storeReceiptNotes.tenantId, tenantId), eq(storeReceiptNotes.grnId, grnId)))
      .limit(1));
    return rows[0] ?? null;
  });
}
