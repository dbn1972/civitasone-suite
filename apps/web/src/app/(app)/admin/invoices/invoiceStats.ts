import { moneyField, normStatus, str } from "../_components/status";
import type { PillVariant } from "@/app/_components/ds/StatusPill";

// billing-service invoices/domain.ts InvoiceStatus (derived from source).
export type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "overdue" | "waived" | "cancelled";

/** Shape of GET /v1/billing/invoices rows (invoices/queries.ts summarize()). Amounts are integer PAISE. */
export type InvoiceRow = {
  id: string;
  periodMonth: string;
  totalMinor: string | number | null;
  paidMinor: string | number | null;
  outstandingMinor: string | number | null;
  issuedAt: string;
  status: string;
};

export function toInvoiceRows(raw: Record<string, unknown>[]): InvoiceRow[] {
  return raw.map((r) => ({
    id: str(r.id),
    periodMonth: str(r.periodMonth),
    totalMinor: moneyField(r.totalMinor),
    paidMinor: moneyField(r.paidMinor),
    outstandingMinor: moneyField(r.outstandingMinor),
    issuedAt: str(r.issuedAt),
    status: str(r.status),
  }));
}

// GAP-ADMIN-INVOICES-05: Pending is an explicit allow-list (issued and
// partially paid = awaiting payment), not total - paid - overdue, which also
// swept drafts, waived and cancelled bills into "Pending".
const PENDING = new Set(["issued", "partially paid"]);

export function invoiceStats(rows: InvoiceRow[]) {
  let paid = 0, overdue = 0, pending = 0;
  for (const r of rows) {
    const s = normStatus(r.status);
    if (s === "paid") paid++;
    else if (s === "overdue") overdue++;
    else if (PENDING.has(s)) pending++;
  }
  // Draft / waived / cancelled / unknown: surfaced so the cards reconcile with Total.
  return { total: rows.length, paid, pending, overdue, other: rows.length - paid - pending - overdue };
}

// GAP-ADMIN-INVOICES-07: deliberate tones for every InvoiceStatus (shared
// StatusPill's global map has no entry for partially paid / waived / cancelled).
const TONES: Record<string, PillVariant> = {
  paid: "good",
  overdue: "bad",
  issued: "warn",
  "partially paid": "warn",
  draft: "mut",
  waived: "mut",
  cancelled: "mut",
};
export function invoiceStatusTone(status: string): PillVariant {
  return TONES[normStatus(status)] ?? "info";
}
