"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function VendorsTable({ vendors, source = "api" }: { vendors: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.vendors", vendors, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "name", label: "Vendor Name" },
          { key: "pan", label: "PAN" },
          { key: "gstin", label: "GSTIN" },
          { key: "category", label: "Category" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        rowLinkKey="id"
        rowLinkPrefix="/finance/vendors/"
        sortable
        filterable
        filterPlaceholder="Search vendors…"
        pageSize={15}
        exportable
        exportFilename="vendor-master"
        emptyIcon="🏢"
        emptyTitle="No vendors"
        emptyMessage="No vendors registered yet."
      />
    </>
  );
}
