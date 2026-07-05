"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function InvoicesTable({ invoices, source = "api" }: { invoices: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("sa.invoices", invoices, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
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
