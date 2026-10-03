"use client";
import { useMemo } from "react";
import Link from "next/link";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import { AdminRegister } from "../_components/AdminRegister";
import { invoiceStats, invoiceStatusTone, toInvoiceRows, type InvoiceRow } from "./invoiceStats";

type RawRow = Record<string, unknown>;
export function InvoicesTable({
  invoices,
  source = "api",
  errorStatus,
  errorMessage,
}: {
  invoices: RawRow[];
  source?: "api" | "error";
  errorStatus?: number;
  errorMessage?: string;
}) {
  const { data: raw, provenance, offline, cachedAt } = useSeededResource<RawRow[]>("sa.invoices", invoices, source, (d) => d.length === 0);
  const rows = useMemo(() => toInvoiceRows(raw), [raw]);
  const s = invoiceStats(rows);
  return (
    // GAP-ADMIN-INVOICES-03/-04: cards, badge, error state and table all read the
    // SAME useSeededResource result, so they can never disagree.
    <AdminRegister
      title="Invoice Register (read-only)"
      area="invoices"
      provenance={provenance ?? "live"}
      cachedAt={cachedAt}
      offline={offline}
      errorStatus={errorStatus}
      errorMessage={errorMessage}
      stats={[
        { icon: "🧾", iconBg: "#eef2ff", label: "Total Invoices", value: s.total },
        { icon: "✅", iconBg: "#ecfdf3", label: "Paid", value: s.paid },
        { icon: "⏳", iconBg: "#fffaeb", label: "Pending", value: s.pending },
        { icon: "⚠️", iconBg: "#fce7ee", label: "Overdue", value: s.overdue },
        { icon: "📄", iconBg: "#f1f5f9", label: "Draft / waived / cancelled", value: s.other, onlyWhenPositive: true },
      ]}
    >
      <DataTable<InvoiceRow>
        // GAP-ADMIN-INVOICES-02: billing-service returns integer PAISE as strings
        // in totalMinor/paidMinor/outstandingMinor; cellType "amount" is formatMoney().
        // GAP-ADMIN-INVOICES-07: rows are typed (InvoiceRow) so a column key that
        // is not on the API shape fails to compile.
        columns={[
          // GAP-ADMIN-INVOICES-06: each invoice number opens its detail page.
          { key: "id", label: "Invoice ID", render: (r) => <Link href={`/admin/invoices/${encodeURIComponent(r.id)}`}>{r.id}</Link> },
          { key: "periodMonth", label: "Period" },
          { key: "totalMinor", label: "Total", align: "right", cellType: "amount" },
          { key: "paidMinor", label: "Paid", align: "right", cellType: "amount" },
          { key: "outstandingMinor", label: "Outstanding", align: "right", cellType: "amount" },
          { key: "issuedAt", label: "Issued", cellType: "date" },
          { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} variant={invoiceStatusTone(r.status)} /> },
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search invoices…" pageSize={15} exportable exportFilename="invoices" emptyIcon="🧾" emptyTitle="No invoices" emptyMessage="No billing invoices found."
      />
    </AdminRegister>
  );
}
