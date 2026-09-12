"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatRupees } from "@/lib/formatters";

export type RevisedEstimateRow = {
  id: string;
  headCode: string;
  description: string;
  // UX-006: null means BE/RE was missing/unparseable on the source row --
  // rendered as an honest "—", never coerced to a fabricated 0.
  budgetEstimate: number | null;
  revisedEstimate: number | null;
  variancePct: number | null;
  status: "increased" | "decreased" | "no_change" | "unknown";
};

// DataTable's generic requires an index signature; RevisedEstimateRow is a
// plain named type. Intersection satisfies the constraint without widening
// away real field names/types.
type Row = RevisedEstimateRow & Record<string, unknown>;

export function RevisedEstimatesTable({ estimates, source = "api" }: { estimates: RevisedEstimateRow[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("finance.revised-estimates", estimates as Row[], source, (d) => d.length === 0);
  return (
    <>
      {/* UX-002: single source of truth — this reads the same useSeededResource
          call as `rows`, so it can never contradict the table it sits above.
          The page used to render its own badge from the raw server `source`. */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Row>
        columns={[
          { key: "headCode", label: "Head" },
          { key: "description", label: "Description" },
          // budgetEstimate/revisedEstimate are already rupees (page.tsx computes
          // them via Number(beMinor)/100), not minor units — formatRupees(), not
          // formatMoney(), which would treat them as paise and show 100x too
          // small. Previously rendered as bare unformatted numbers (no ₹, no
          // Indian digit grouping, no fixed 2dp).
          { key: "budgetEstimate", label: "BE", align: "right", render: (r) => formatRupees(r.budgetEstimate as number | null) },
          { key: "revisedEstimate", label: "RE", align: "right", render: (r) => formatRupees(r.revisedEstimate as number | null) },
          // UX-006: variancePct is null when BE/RE was missing — show "—", not "NaN%"/"0.0%".
          { key: "variancePct", label: "Variance %", align: "right", render: (r) => (r.variancePct == null ? "—" : `${(r.variancePct as number).toFixed(1)}%`) },
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
