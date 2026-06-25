import * as repo from "./repo.js";
import type { BillingPaymentRow } from "./schema.js";

function summarize(r: BillingPaymentRow) {
  return {
    id: r.id,
    invoiceId: r.invoiceId,
    amountMinor: r.amountMinor.toString(),
    currency: r.currency,
    method: r.method,
    status: r.status,
    receiptNo: r.receiptNo,
    reference: r.reference,
    receivedAt: r.receivedAt,
  };
}

export async function listReceiptsForInvoice(invoiceId: string, tenantId: string) {
  const rows = await repo.listByInvoice(invoiceId, tenantId);
  return rows.map(summarize);
}

export async function listReceiptsForTenant(tenantId: string) {
  const rows = await repo.listByTenant(tenantId);
  return rows.map(summarize);
}
