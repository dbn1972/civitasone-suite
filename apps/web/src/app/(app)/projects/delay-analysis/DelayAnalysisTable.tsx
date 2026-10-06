"use client";

import { DataTable, RagPill } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

export type DelayRow = {
  project: string;
  // GAP-PROJECTS-DELAY-ANALYSIS-02: opaque project id used to link a row to
  // /projects/<id>. Optional because the backend may not yet return it; when
  // absent, DataTable's resolveHref() leaves the row un-linked (no
  // ".../undefined" link) rather than breaking — the link lights up
  // automatically once the endpoint supplies projectId.
  projectId?: string;
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
  render?: (row: DelayRow) => React.ReactNode;
}[] = [
  { key: "project", label: "Project Name" },
  { key: "originalDeadline", label: "Original Deadline" },
  { key: "revisedDeadline", label: "Revised Deadline" },
  { key: "delayDays", label: "Delay (days)", align: "right" },
  { key: "cause", label: "Cause" },
  // GAP-PROJECTS-DELAY-ANALYSIS-01: render a real RAG pill (Green/Amber/Red
  // with colour) via the shared RagPill, instead of StatusPill painting the
  // raw active/review/overdue word with lifecycle colours.
  { key: "rag", label: "RAG", render: (r) => <RagPill rag={r.rag} /> },
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
        rowLinkPrefix="/projects/"
        rowLinkKey="projectId"
        identifyingColumnKey="project"
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
