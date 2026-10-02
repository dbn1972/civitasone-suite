"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceBudgetAllocationSummary } from "@civitasone/types";
import { budgetHeadLabel } from "../_lib/headLabel";
type Row = FinanceBudgetAllocationSummary;
type DisplayRow = Row & { _head: string };
export function AllocationTable({ allocations, source = "api" }: { allocations: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("finance.allocations", allocations, source, (d) => d.length === 0);
  // GAP-FINANCE-BUDGET-ALLOCATION-01: "3054 · Roads and Bridges", not a uuid.
  const display: DisplayRow[] = rows.map((r) => ({ ...r, _head: budgetHeadLabel(r) }));
  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<DisplayRow>
        columns={[
          { key: "_head", label: "Budget Head", render: (r) => <span title={r.headId}>{r._head}</span> },
          { key: "fy", label: "FY" },
          { key: "allocatedMinor", label: "Allocated", align: "right", cellType: "amount" },
          { key: "committedMinor", label: "Committed", align: "right", cellType: "amount" },
          { key: "actualMinor", label: "Expended", align: "right", cellType: "amount" },
          { key: "availableMinor", label: "Balance", align: "right", cellType: "amount" },
        ]}
        rows={display}
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
