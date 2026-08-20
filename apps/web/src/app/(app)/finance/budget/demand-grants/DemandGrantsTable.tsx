"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceDemandSummary } from "@civitasone/types";
type Row = FinanceDemandSummary;
export function DemandGrantsTable({ grants, source = "api" }: { grants: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.demand-grants", grants, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
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
