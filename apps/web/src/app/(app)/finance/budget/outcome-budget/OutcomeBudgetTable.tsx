"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function OutcomeBudgetTable({ outcomes, source = "api" }: { outcomes: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.outcome-budget", outcomes, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "scheme", label: "Scheme" },
          { key: "indicator", label: "Output Indicator" },
          { key: "target", label: "Target", align: "right" },
          { key: "achieved", label: "Achieved", align: "right" },
          { key: "achievementPct", label: "% Done", align: "right" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search outcomes…"
        pageSize={15}
        exportable
        exportFilename="outcome-budget"
        emptyIcon="🎯"
        emptyTitle="No outcomes"
        emptyMessage="No outcome budget indicators found."
      />
    </>
  );
}
