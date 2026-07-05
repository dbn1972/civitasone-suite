"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function DemandGrantsTable({ grants, source = "api" }: { grants: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.demand-grants", grants, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "demandNo", label: "Demand No" },
          { key: "ministry", label: "Ministry/Dept" },
          { key: "type", label: "Type" },
          { key: "votedAmount", label: "Voted", align: "right" },
          { key: "chargedAmount", label: "Charged", align: "right" },
          { key: "total", label: "Total", align: "right" },
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
