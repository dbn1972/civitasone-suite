"use client";

import { DataTable, StatusPill } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

export type EscalationRow = {
  escalationId: string;
  // GAP-PROJECTS-ESCALATIONS-03: opaque project id for linking to
  // /projects/<id>. Optional until the endpoint supplies it; DataTable leaves
  // the row un-linked (no ".../undefined") while absent.
  projectId?: string;
  project: string;
  issue: string;
  severity: string;
  escalatedTo: string;
  raisedDate: string;
  status: string;
} & Record<string, unknown>;

// GAP-PROJECTS-ESCALATIONS-03: the backend borrows status words (blocked/
// overdue/pending) for severity. Present them with the queue's own vocabulary
// (Critical/High/...) rather than the raw status word.
const SEVERITY_LABEL: Record<string, string> = {
  blocked: "Critical",
  overdue: "High",
  pending: "Medium",
};

// GAP-PROJECTS-ESCALATIONS-02: in the GLOBAL StatusPill map 'open' is green
// (a successful/available state for most modules), which makes an UNRESOLVED
// escalation look healthy. Rather than recolour 'open' app-wide, scope the
// override to this queue: an open/submitted escalation is unresolved (warn),
// only 'cleared' is good. Any other value falls back to StatusPill's default.
const ESCALATION_STATUS_VARIANT: Record<string, "good" | "warn" | "bad" | "mut" | "info"> = {
  open: "bad",
  submitted: "warn",
  "under review": "warn",
  acknowledged: "warn",
  cleared: "good",
};

const COLUMNS: {
  key: keyof EscalationRow & string;
  label: string;
  cellType?: "status" | "amount";
  render?: (row: EscalationRow) => React.ReactNode;
}[] = [
  { key: "project", label: "Project" },
  { key: "issue", label: "Issue" },
  { key: "severity", label: "Severity", render: (r) => SEVERITY_LABEL[r.severity] ?? r.severity },
  { key: "escalatedTo", label: "Escalated To" },
  { key: "raisedDate", label: "Raised Date" },
  {
    key: "status",
    label: "Status",
    render: (r) => <StatusPill status={r.status} variant={ESCALATION_STATUS_VARIANT[r.status.toLowerCase()]} />,
  },
  { key: "escalationId", label: "Ref" },
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
        rowLinkPrefix="/projects/"
        rowLinkKey="projectId"
        identifyingColumnKey="project"
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
