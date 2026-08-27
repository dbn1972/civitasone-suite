"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import { formatRupees } from "@/lib/formatters";

export type RevisedEstimateRow = {
  id: string;
  headCode: string;
  description: string;
  budgetEstimate: number;
  revisedEstimate: number;
  variancePct: number;
  status: "increased" | "decreased" | "no_change";
};

// DataTable's generic requires an index signature; RevisedEstimateRow is a
// plain named type. Intersection satisfies the constraint without widening
// away real field names/types.
type Row = RevisedEstimateRow & Record<string, unknown>;

export function RevisedEstimatesTable({ estimates, source = "api" }: { estimates: RevisedEstimateRow[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.revised-estimates", estimates as Row[], source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "headCode", label: "Head" },
          { key: "description", label: "Description" },
          // budgetEstimate/revisedEstimate are already rupees (page.tsx computes
          // them via Number(beMinor)/100), not minor units — formatRupees(), not
          // formatMoney(), which would treat them as paise and show 100x too
          // small. Previously rendered as bare unformatted numbers (no ₹, no
          // Indian digit grouping, no fixed 2dp).
          { key: "budgetEstimate", label: "BE", align: "right", render: (r) => formatRupees(r.budgetEstimate as number) },
          { key: "revisedEstimate", label: "RE", align: "right", render: (r) => formatRupees(r.revisedEstimate as number) },
          { key: "variancePct", label: "Variance %", align: "right", render: (r) => `${(r.variancePct as number).toFixed(1)}%` },
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
