"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

export type DelayRow = {
  project: string;
  originalDeadline: string;
  revisedDeadline: string;
  delayDays: number;
  cause: string;
  rag: string;
} & Record<string, unknown>;

const COLUMNS: {
  key: keyof DelayRow & string;
  label: string;
  cellType?: "status" | "amount";
  align?: "left" | "right" | "center";
}[] = [
  { key: "project", label: "Project Name" },
  { key: "originalDeadline", label: "Original Deadline" },
  { key: "revisedDeadline", label: "Revised Deadline" },
  { key: "delayDays", label: "Delay (days)", align: "right" },
  { key: "cause", label: "Cause" },
  { key: "rag", label: "RAG Status", cellType: "status" },
];

export function DelayAnalysisTable({ rows, source = "api" }: { rows: DelayRow[]; source?: "api" | "error" }) {
  const { data, fromCache, offline, cachedAt } = useSeededResource<DelayRow[]>(
    "projects.delay-analysis",
    rows,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<DelayRow>
        columns={COLUMNS}
        rows={data}
        sortable
        filterable
        filterPlaceholder="Filter projects…"
        pageSize={15}
        exportable
        exportFilename="project-delay-analysis"
        emptyIcon="📋"
        emptyTitle="No delay data"
        emptyMessage="No projects match the current filter."
      />
    </>
  );
}
