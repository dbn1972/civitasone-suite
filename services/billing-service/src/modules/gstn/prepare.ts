import { and, eq, gte, lt, sql, inArray } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { billingInvoices } from "../invoices/schema.js";

/**
 * GAP-BILLING-GSTN-03 (UAT B4): return preparation. Totals for one supplier GSTIN and one IST
 * calendar month, computed from the caller's own issued invoices, so the console can prefill the
 * return and show the officer any variance against what they typed. Read-only; the officer still
 * files (and takes responsibility for) the return.
 *
 * Counted: issued, partially paid, paid and overdue invoices whose issue instant falls in the
 * month in IST. Not counted: draft, cancelled, waived. Taxable value = total - tax. A legacy
 * invoice that has tax but no CGST/SGST/IGST split cannot be placed in a column; its tax is
 * reported separately as unsplit rather than guessed or dropped.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const COUNTED_STATUSES = ["issued", "partially_paid", "paid", "overdue"];

/** [00:00 IST on the 1st, 00:00 IST on the 1st of the next month) as UTC instants. period is MM/YYYY. */
export function istMonthRangeUtc(period: string): { from: Date; to: Date } {
  const [mm, yyyy] = period.split("/");
  const m = Number(mm);
  const y = Number(yyyy);
  return {
    from: new Date(Date.UTC(y, m - 1, 1) - IST_OFFSET_MS),
    to: new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS),
  };
}

export interface ReturnPreparation {
  gstin: string;
  period: string;
  invoiceCount: number;
  totalTaxableMinor: string;
  totalCgstMinor: string;
  totalSgstMinor: string;
  totalIgstMinor: string;
  unsplitTaxMinor: string;
  unsplitTaxInvoiceCount: number;
}

export async function prepareReturn(tenantId: string, gstin: string, period: string): Promise<ReturnPreparation> {
  const { from, to } = istMonthRangeUtc(period);
  const rows = await scopedRead((tx) =>
    tx
      .select({
        n: sql<string>`COUNT(*)`,
        taxable: sql<string>`COALESCE(SUM(${billingInvoices.totalMinor} - ${billingInvoices.taxMinor}), 0)`,
        cgst: sql<string>`COALESCE(SUM(${billingInvoices.cgstMinor}), 0)`,
        sgst: sql<string>`COALESCE(SUM(${billingInvoices.sgstMinor}), 0)`,
        igst: sql<string>`COALESCE(SUM(${billingInvoices.igstMinor}), 0)`,
        unsplit: sql<string>`COALESCE(SUM(CASE WHEN ${billingInvoices.cgstMinor} + ${billingInvoices.sgstMinor} + ${billingInvoices.igstMinor} = 0 THEN ${billingInvoices.taxMinor} ELSE 0 END), 0)`,
        unsplitN: sql<string>`COUNT(*) FILTER (WHERE ${billingInvoices.cgstMinor} + ${billingInvoices.sgstMinor} + ${billingInvoices.igstMinor} = 0 AND ${billingInvoices.taxMinor} > 0)`,
      })
      .from(billingInvoices)
      .where(
        and(
          eq(billingInvoices.tenantId, tenantId),
          eq(billingInvoices.supplierGstin, gstin),
          inArray(billingInvoices.status, COUNTED_STATUSES),
          gte(billingInvoices.issuedAt, from),
          lt(billingInvoices.issuedAt, to),
        ),
      ),
  );
  const r = rows[0];
  return {
    gstin,
    period,
    invoiceCount: Number(r?.n ?? 0),
    totalTaxableMinor: String(r?.taxable ?? "0"),
    totalCgstMinor: String(r?.cgst ?? "0"),
    totalSgstMinor: String(r?.sgst ?? "0"),
    totalIgstMinor: String(r?.igst ?? "0"),
    unsplitTaxMinor: String(r?.unsplit ?? "0"),
    unsplitTaxInvoiceCount: Number(r?.unsplitN ?? 0),
  };
}
