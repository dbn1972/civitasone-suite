"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function RevisedEstimatesTable({ estimates, source = "api" }: { estimates: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.revised-estimates", estimates, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "headCode", label: "Head" },
          { key: "description", label: "Description" },
          { key: "budgetEstimate", label: "BE", align: "right" },
          { key: "revisedEstimate", label: "RE", align: "right" },
          { key: "variancePct", label: "Variance %", align: "right" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search estimates…"
        pageSize={15}
        exportable
        exportFilename="revised-estimates"
        emptyIcon="📊"
        emptyTitle="No estimates"
        emptyMessage="No revised estimate data found for this FY."
      />
    </>
  );
}
