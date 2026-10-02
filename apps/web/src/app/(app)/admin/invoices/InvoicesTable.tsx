"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function InvoicesTable({ invoices, source = "api" }: { invoices: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("sa.invoices", invoices, source, (d) => d.length === 0);
  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Row>
        // GAP-ADMIN-INVOICES-02: billing-service GET /v1/billing/invoices
        // (invoices/queries.ts summarize()) returns integer PAISE as strings
        // in totalMinor/paidMinor/outstandingMinor -- there has never been an
        // `amount`, `invoiceNo`, `tenant` or `dueDate` field, so the old
        // columns rendered blank (and a bare `amount` would have read 100x
        // too large). cellType "amount" is formatMoney(): paise -> ₹ with
        // Indian (lakh) grouping.
        columns={[
          { key: "id", label: "Invoice ID" },
          { key: "periodMonth", label: "Period" },
          { key: "totalMinor", label: "Total", align: "right", cellType: "amount" },
          { key: "paidMinor", label: "Paid", align: "right", cellType: "amount" },
          { key: "outstandingMinor", label: "Outstanding", align: "right", cellType: "amount" },
          { key: "issuedAt", label: "Issued", cellType: "date" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search invoices…" pageSize={15} exportable exportFilename="invoices" emptyIcon="🧾" emptyTitle="No invoices" emptyMessage="No billing invoices found."
      />
    </>
  );
}
