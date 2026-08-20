"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { BudgetOutcomeSummary } from "@civitasone/types";
type Row = BudgetOutcomeSummary;
export function OutcomeBudgetTable({ outcomes, source = "api" }: { outcomes: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.outcome-budget", outcomes, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "outcomeDesc", label: "Outcome" },
          { key: "indicator", label: "Output Indicator" },
          { key: "targetValue", label: "Target", align: "right" },
          { key: "achievedValue", label: "Achieved", align: "right" },
          {
            key: "achievementBps",
            label: "% Done",
            align: "right",
            // achievementBps is basis points (0–10000+), not a 0–100 percent — divide by 100 to display.
            render: (o) => <>{(Number(o.achievementBps ?? 0) / 100).toFixed(1)}%</>,
          },
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
