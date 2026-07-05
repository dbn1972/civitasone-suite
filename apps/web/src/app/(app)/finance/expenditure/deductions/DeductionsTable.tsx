"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function DeductionsTable({ deductions, source = "api" }: { deductions: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.deductions", deductions, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "billNo", label: "Bill No" },
          { key: "vendor", label: "Vendor" },
          { key: "tds", label: "TDS", align: "right" },
          { key: "incomeTax", label: "IT", align: "right" },
          { key: "gst", label: "GST", align: "right" },
          { key: "netPayable", label: "Net Payable", align: "right" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search deductions…"
        pageSize={15}
        exportable
        exportFilename="deduction-register"
        emptyIcon="🧮"
        emptyTitle="No deductions"
        emptyMessage="No statutory deduction records found."
      />
    </>
  );
}
