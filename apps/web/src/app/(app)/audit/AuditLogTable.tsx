"use client";

import { DataTable } from "@/app/_components/ds";
import type { AuditRowSummary } from "@civitasone/types";

// Local row type (object alias) so it satisfies DataTable's Record<string, unknown>
// generic constraint — the shared AuditRowSummary is an interface and does not.
type AuditRow = {
  actor: string;
  action: string;
  resource: string;
  outcome: "success" | "failure";
};

export function AuditLogTable({ rows }: { rows: AuditRowSummary[] }) {
  return (
    <DataTable<AuditRow>
      columns={[
        { key: "actor", label: "Actor" },
        { key: "action", label: "Action", render: (r) => <span className="mono">{r.action}</span> },
        { key: "resource", label: "Target" },
        {
          key: "outcome",
          label: "Result",
          render: (r) =>
            r.outcome === "success" ? <span className="pill good">success</span> : <span className="pill bad">failure</span>,
        },
      ]}
      rows={rows}
      sortable
      filterable
      filterPlaceholder="Filter by actor, action, target, outcome…"
      pageSize={15}
    />
  );
}
