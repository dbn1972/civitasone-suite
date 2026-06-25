import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { outstandingMinor } from "./domain.js";
import type { BillingInvoiceRow } from "./schema.js";

export async function listInvoices(tenantId: string) {
  const rows = await cache.getOrLoad(cache.makeKey(tenantId, "invoices", tenantId), () => repo.listByTenant(tenantId));
  return (rows ?? []).map(summarize);
}

function summarize(r: BillingInvoiceRow) {
  return {
    id: r.id,
    periodMonth: r.periodMonth,
    status: r.status,
    totalMinor: r.totalMinor.toString(),
    paidMinor: r.paidMinor.toString(),
    outstandingMinor: outstandingMinor(r.totalMinor, r.paidMinor).toString(),
    currency: r.currency,
    issuedAt: r.issuedAt,
    paidAt: r.paidAt,
    cancelledAt: r.cancelledAt,
  };
}

/** Full bill detail with line items, approvals, and computed outstanding. Tenant-scoped. */
export async function getInvoiceDetail(id: string, tenantId: string) {
  const inv = await repo.findById(id);
  if (!inv || inv.tenantId !== tenantId) return null;
  const [items, approvals] = await Promise.all([repo.itemsByInvoice(id), repo.approvalsByInvoice(id)]);
  return {
    ...summarize(inv),
    taxMinor: inv.taxMinor.toString(),
    chargesMinor: inv.chargesMinor.toString(),
    cancelReason: inv.cancelReason,
    issuedBy: inv.issuedBy,
    cancelledBy: inv.cancelledBy,
    items: items.map((it) => ({
      id: it.id, description: it.description, kind: it.kind,
      quantity: it.quantity.toString(), amountMinor: it.amountMinor.toString(),
    })),
    approvals: approvals.map((a) => ({
      id: a.id, action: a.action, status: a.status, amountMinor: a.amountMinor.toString(),
      requestedBy: a.requestedBy, decidedBy: a.decidedBy, decidedAt: a.decidedAt, reason: a.reason,
    })),
  };
}

/** Tenant outstanding aggregate (paise) across all live bills. */
export async function getOutstanding(tenantId: string) {
  const agg = await repo.outstandingByTenant(tenantId);
  return {
    tenantId,
    openCount: agg.openCount,
    billedMinor: agg.billedMinor.toString(),
    paidMinor: agg.paidMinor.toString(),
    outstandingMinor: agg.outstandingMinor.toString(),
  };
}

/** Internal helper for the payments module: load a bill for receipt validation. */
export async function getInvoiceForPayment(id: string, tenantId: string): Promise<BillingInvoiceRow | null> {
  const inv = await repo.findById(id);
  if (!inv || inv.tenantId !== tenantId) return null;
  return inv;
}
