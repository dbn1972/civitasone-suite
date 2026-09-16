"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceBudgetAllocationSummary } from "@civitasone/types";
type Row = FinanceBudgetAllocationSummary;
export function AllocationTable({ allocations, source = "api" }: { allocations: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("finance.allocations", allocations, source, (d) => d.length === 0);
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
          { key: "headId", label: "Budget Head" },
          { key: "fy", label: "FY" },
          { key: "allocatedMinor", label: "Allocated", align: "right", cellType: "amount" },
          { key: "committedMinor", label: "Committed", align: "right", cellType: "amount" },
          { key: "actualMinor", label: "Expended", align: "right", cellType: "amount" },
          { key: "availableMinor", label: "Balance", align: "right", cellType: "amount" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search allocations…"
        pageSize={15}
        exportable
        exportFilename="budget-allocations"
        emptyIcon="📊"
        emptyTitle="No allocations"
        emptyMessage="No budget allocation records found."
      />
    </>
  );
}
