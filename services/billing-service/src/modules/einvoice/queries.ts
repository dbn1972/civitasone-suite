import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { EInvoiceRequestRow } from "./schema.js";

function summarize(r: EInvoiceRequestRow) {
  return {
    id: r.id,
    invoiceId: r.invoiceId,
    irn: r.irn,
    ackNo: r.ackNo,
    ackDate: r.ackDate,
    signedQrCode: r.signedQrCode,
    status: r.status,
    errorMessage: r.errorMessage,
    cancelledAt: r.cancelledAt,
    cancelReason: r.cancelReason,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function getEInvoiceByInvoiceId(invoiceId: string, tenantId: string) {
  const row = await cache.getOrLoad(
    cache.makeKey(tenantId, "einvoice", invoiceId),
    () => repo.findByInvoiceId(invoiceId, tenantId),
  );
  if (!row) return null;
  return summarize(row);
}
