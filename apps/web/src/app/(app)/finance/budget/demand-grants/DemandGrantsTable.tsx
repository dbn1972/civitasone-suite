"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceDemandSummary } from "@civitasone/types";
type Row = FinanceDemandSummary;
export function DemandGrantsTable({ grants, source = "api" }: { grants: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("finance.demand-grants", grants, source, (d) => d.length === 0);
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
          { key: "demandNo", label: "Demand No" },
          { key: "service", label: "Service" },
          { key: "class", label: "Class" },
          { key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search demands…"
        pageSize={15}
        exportable
        exportFilename="demand-grants"
        emptyIcon="🏛️"
        emptyTitle="No demands"
        emptyMessage="No demand for grants records found."
      />
    </>
  );
}
