"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function GemEInvoiceTable({ invoices, source = "api" }: { invoices: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.gem-einvoice", invoices, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "irn", label: "IRN" },
          { key: "vendor", label: "Vendor" },
          { key: "gemOrderNo", label: "GeM Order" },
          { key: "amount", label: "Amount", align: "right" },
          { key: "date", label: "Date" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search e-invoices…"
        pageSize={15}
        exportable
        exportFilename="gem-einvoice"
        emptyIcon="🛒"
        emptyTitle="No e-invoices"
        emptyMessage="No GeM or e-invoice records found."
      />
    </>
  );
}
