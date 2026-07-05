"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function TDSReturnsTable({ returns, source = "api" }: { returns: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.tds-returns", returns, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "formType", label: "Form" },
          { key: "quarter", label: "Quarter" },
          { key: "fy", label: "FY" },
          { key: "deductees", label: "Deductees", align: "right" },
          { key: "totalTds", label: "Total TDS", align: "right" },
          { key: "filedDate", label: "Filed Date" },
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
