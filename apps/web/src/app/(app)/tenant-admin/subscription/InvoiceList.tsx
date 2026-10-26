"use client";

import { useTranslations } from "next-intl";
import { EmptyState, StatusPill } from "@/app/_components/ds";
import { formatIndianDate, formatMoney, humanizeStatus } from "@/lib/formatters";

/**
 * Tenant invoice list with the GST tax-invoice columns (owner decision #26,
 * GAP-TENANT-ADMIN-PLANS-04). Amounts arrive as minor-unit STRINGS (bigint-safe,
 * as billing-service sends them) and are formatted via formatMoney only.
 * A legacy invoice with no GST detail shows a dash, never an invented value.
 */
export type InvoiceRow = {
  id: string;
  invoiceNumber?: string | null;
  periodMonth?: string | null;
  issuedAt?: string | null;
  status: string;
  totalMinor: string;
  supplierGstin?: string | null;
  recipientGstin?: string | null;
  placeOfSupply?: string | null;
  cgstMinor?: string | null;
  sgstMinor?: string | null;
  igstMinor?: string | null;
};

const dash = (v: string | null | undefined): string => (v ? v : "—");

export function InvoiceList({ invoices }: { invoices: InvoiceRow[] }) {
  const t = useTranslations("tenantAdminW2.billingInvoices");
  if (invoices.length === 0) {
    return <EmptyState icon="🧾" title={t("emptyTitle")} message={t("emptyMessage")} />;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="data-table" role="table" aria-label={t("tableLabel")}>
        <thead>
          <tr>
            <th scope="col">{t("number")}</th>
            <th scope="col">{t("date")}</th>
            <th scope="col">{t("supplierGstin")}</th>
            <th scope="col">{t("recipientGstin")}</th>
            <th scope="col">{t("placeOfSupply")}</th>
            <th scope="col">{t("cgst")}</th>
            <th scope="col">{t("sgst")}</th>
            <th scope="col">{t("igst")}</th>
            <th scope="col">{t("total")}</th>
            <th scope="col">{t("status")}</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id}>
              <td>{dash(inv.invoiceNumber)}</td>
              <td>{inv.issuedAt ? formatIndianDate(inv.issuedAt) : dash(inv.periodMonth)}</td>
              <td>{dash(inv.supplierGstin)}</td>
              <td>{dash(inv.recipientGstin)}</td>
              <td>{dash(inv.placeOfSupply)}</td>
              <td>{inv.supplierGstin ? formatMoney(inv.cgstMinor ?? "0") : "—"}</td>
              <td>{inv.supplierGstin ? formatMoney(inv.sgstMinor ?? "0") : "—"}</td>
              <td>{inv.supplierGstin ? formatMoney(inv.igstMinor ?? "0") : "—"}</td>
              <td>{formatMoney(inv.totalMinor)}</td>
              <td><StatusPill status={inv.status} label={humanizeStatus(inv.status)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
