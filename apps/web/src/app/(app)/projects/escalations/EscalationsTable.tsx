"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

export type EscalationRow = {
  escalationId: string;
  project: string;
  issue: string;
  severity: string;
  escalatedTo: string;
  raisedDate: string;
  status: string;
} & Record<string, unknown>;

const COLUMNS: {
  key: keyof EscalationRow & string;
  label: string;
  cellType?: "status" | "amount";
}[] = [
  { key: "escalationId", label: "Escalation ID" },
  { key: "project", label: "Project" },
  { key: "issue", label: "Issue" },
  { key: "severity", label: "Severity", cellType: "status" },
  { key: "escalatedTo", label: "Escalated To" },
  { key: "raisedDate", label: "Raised Date" },
  { key: "status", label: "Status", cellType: "status" },
];

export function EscalationsTable({ rows, source = "api" }: { rows: EscalationRow[]; source?: "api" | "error" }) {
  const { data, fromCache, offline, cachedAt } = useSeededResource<EscalationRow[]>(
    "projects.escalations",
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
      <DataTable<EscalationRow>
        columns={COLUMNS}
        rows={data}
        sortable
        filterable
        filterPlaceholder="Filter escalations…"
        pageSize={15}
        exportable
        exportFilename="project-escalations"
        emptyIcon="🚨"
        emptyTitle="No escalations"
        emptyMessage="No escalations match the current filter."
      />
    </>
  );
}
