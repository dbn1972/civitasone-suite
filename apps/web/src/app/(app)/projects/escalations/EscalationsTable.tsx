"use client";

import type React from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import { EscalationActions } from "./EscalationActions";

export type EscalationRow = {
  // GAP2-PROJECTS-ESCALATIONS-04: real persisted record id (null until the
  // escalation is acted on) — no fabricated "ESC-NNN" sequence.
  escalationId: string | null;
  // GAP-PROJECTS-ESCALATIONS-03: opaque project id for linking to
  // /projects/<id>. Optional until the endpoint supplies it; DataTable leaves
  // the row un-linked (no ".../undefined") while absent.
  projectId?: string;
  project: string;
  // GAP2-PROJECTS-ESCALATIONS-04: issue/escalatedTo come from the persisted
  // record only and are null when no escalation has been raised (no invented
  // "Critical blocker reported" / "Program Director" text).
  issue: string | null;
  severity: string;
  escalatedTo: string | null;
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
  // GAP2-PROJECTS-ESCALATIONS-04: issue/escalatedTo/escalationId are null until
  // a real escalation record exists — render an honest "—", never fabricated text.
  { key: "issue", label: "Issue", render: (r) => r.issue ?? "—" },
  { key: "severity", label: "Severity", render: (r) => SEVERITY_LABEL[r.severity] ?? r.severity },
  { key: "escalatedTo", label: "Escalated To", render: (r) => r.escalatedTo ?? "—" },
  { key: "raisedDate", label: "Raised Date" },
  {
    key: "status",
    label: "Status",
    render: (r) => <StatusPill status={r.status} variant={ESCALATION_STATUS_VARIANT[r.status.toLowerCase()]} />,
  },
  { key: "escalationId", label: "Ref", render: (r) => r.escalationId ?? "—" },
];

export function EscalationsTable({ rows, source = "api", canAct = false }: { rows: EscalationRow[]; source?: "api" | "error"; canAct?: boolean }) {
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

  // GAP-PROJECTS-ESCALATIONS-02: the Actions column (Acknowledge / Reassign /
  // Clear) only exists for a user whose role the server would accept, and only
  // while the escalation is not already cleared and carries a projectId (the
  // action route's path segment). Non-authorised users see no controls
  // (defence-in-depth; the server still 403s).
  const columns = canAct
    ? [
        ...COLUMNS,
        {
          key: "escalationId" as keyof EscalationRow & string,
          label: "Actions",
          render: (r: EscalationRow) => {
            if (!r.projectId) return null;
            return (
              <EscalationActions
                projectId={r.projectId}
                escalationId={r.escalationId ?? r.project}
                status={r.status}
                severity={r.severity}
                issue={r.issue ?? undefined}
              />
            );
          },
        },
      ]
    : COLUMNS;

  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<EscalationRow>
        columns={columns}
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
