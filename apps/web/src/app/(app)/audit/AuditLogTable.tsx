"use client";

import { useMemo } from "react";
import { DataTable } from "@/app/_components/ds";
import type { AuditRowSummary } from "@civitasone/types";

// Local row type (object alias) so it satisfies DataTable's Record<string, unknown>
// generic constraint — the shared AuditRowSummary is an interface and does not.
type AuditRow = {
  at: string | null;
  actor: string;
  action: string;
  resource: string;
  outcome: "success" | "failure";
  eventId: string;
};

export function AuditLogTable({ rows }: { rows: AuditRowSummary[] }) {
  // GAP-AUDIT-HOME-03: an audit log without "when" cannot support an
  // investigation. Surface the event timestamp (kept by mapAuditRows) as a
  // sortable "When" column and default the view to newest-first so the most
  // recent activity is on top before the user sorts anything.
  const tableRows = useMemo<AuditRow[]>(
    () =>
      rows
        .map((r) => ({
          at: r.at ?? null,
          actor: r.actor,
          action: r.action,
          resource: r.resource,
          outcome: r.outcome,
          eventId: r.id ?? "",
        }))
        .sort((a, b) => {
          const ta = a.at ? Date.parse(a.at) : 0;
          const tb = b.at ? Date.parse(b.at) : 0;
          return tb - ta;
        }),
    [rows],
  );

  return (
    <DataTable<AuditRow>
      columns={[
        { key: "at", label: "When", sortable: true, cellType: "datetime" },
        { key: "actor", label: "Actor" },
        { key: "action", label: "Action", render: (r) => <span className="mono">{r.action}</span> },
        { key: "resource", label: "Target" },
        {
          key: "outcome",
          label: "Result",
          render: (r) =>
            r.outcome === "success" ? <span className="pill good">success</span> : <span className="pill bad">failure</span>,
        },
        {
          key: "eventId",
          label: "Event id",
          render: (r) => (r.eventId ? <span className="mono" title={r.eventId}>{r.eventId.slice(0, 8)}</span> : <span>—</span>),
        },
      ]}
      rows={tableRows}
      sortable
      filterable
      filterPlaceholder="Filter by actor, action, target, outcome…"
      pageSize={15}
    />
  );
}
