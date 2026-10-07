"use client";

import { DataTable } from "../../../_components/ds";
import { StatusBadge } from "../_components/StatusBadge";
import { ExperimentActions } from "./ExperimentActions";
import { statusLabel } from "./experiments";

export type ExperimentRow = { id: string; name: string; status: string; winner: string; actions: string };

/**
 * Client Component: DataTable `render` functions cannot cross the Server ->
 * Client boundary, so the page passes only serializable rows and the cell
 * renderers live here (see scripts/ci/datatable-render-guard.mjs).
 */
export function ExperimentsTable({ rows }: { rows: ExperimentRow[] }) {
  return (
    <DataTable<ExperimentRow>
      columns={[
        { key: "name", label: "Name" },
        { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} label={statusLabel(r.status)} /> },
        { key: "winner", label: "Winner variant" },
        { key: "actions", label: "Actions", render: (r) => <ExperimentActions id={r.id} status={r.status} /> },
      ]}
      rows={rows}
      sortable
      exportable
      exportFilename="notification-experiments"
      emptyIcon="🧪"
      emptyTitle="No experiments"
      emptyMessage="Create an A/B or multivariate experiment to start hyper-personalisation."
    />
  );
}
