"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceBudgetAllocationSummary } from "@civitasone/types";
type Row = FinanceBudgetAllocationSummary;
export function AllocationTable({ allocations, source = "api" }: { allocations: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.allocations", allocations, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
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
