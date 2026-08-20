"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { VendorTdsEntry } from "@civitasone/types";
type Row = VendorTdsEntry;
export function TDSReturnsTable({ returns, source = "api" }: { returns: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.tds-returns", returns, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "vendor_name", label: "Vendor" },
          { key: "section", label: "Section" },
          { key: "quarter", label: "Quarter" },
          { key: "fy", label: "FY" },
          { key: "tds_amount_minor", label: "Total TDS", align: "right", cellType: "amount" },
          { key: "deduction_date", label: "Deduction Date" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search TDS returns…"
        pageSize={15}
        exportable
        exportFilename="tds-returns"
        emptyIcon="📑"
        emptyTitle="No TDS returns"
        emptyMessage="No TDS return records found."
      />
    </>
  );
}
