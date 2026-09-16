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
        columns={[
          { key: "invoiceNo", label: "Invoice No" },
          { key: "tenant", label: "Tenant" },
          { key: "amount", label: "Amount", align: "right" },
          { key: "period", label: "Period" },
          { key: "dueDate", label: "Due Date" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search invoices…" pageSize={15} exportable exportFilename="invoices" emptyIcon="🧾" emptyTitle="No invoices" emptyMessage="No billing invoices found."
      />
    </>
  );
}
