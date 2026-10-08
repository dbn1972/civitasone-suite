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
  // GAP2-AUDIT-HOME-11: keep the real outcome string (not just success/failure)
  // so an outcome like "skipped"/"held" is not collapsed into a red failure.
  outcome: string;
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
          // GAP2-AUDIT-HOME-11: success -> good, failure -> bad, anything else
          // (skipped/held/unknown) -> a neutral pill showing its real value,
          // never a red "failure" for an outcome we don't actually know is bad.
          render: (r) =>
            r.outcome === "success" ? (
              <span className="pill good">success</span>
            ) : r.outcome === "failure" ? (
              <span className="pill bad">failure</span>
            ) : (
              <span className="pill">{r.outcome || "unknown"}</span>
            ),
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
